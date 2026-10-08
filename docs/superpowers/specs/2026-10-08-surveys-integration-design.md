# アンケートの管理と回答受付 本接続 設計書

- 作成日: 2026-10-08
- 状態: 実装済み
- 関連: `docs/04-features.md` F-06〜F-14、`docs/02-database.md` 3.9〜3.12・3.15、`docs/05-open-issues.md` I-01 / I-02 / I-06 / I-08 / I-11
- 後続: サブプロジェクト②「ダッシュボードと利用量」（別の設計書で扱う）

## 0. 目的と範囲

### 目的

アンケートの管理画面と公開アンケート（未ログインの回答画面）を、モックから Firebase（Firestore + Cloud Functions）に本接続する。

### 決定事項（ヒアリング結果）

| 項目 | 決定 |
| --- | --- |
| 分割 | 「① アンケートの管理と回答受付」と「② ダッシュボードと利用量」に分ける。本書は ① |
| 遷移ルール（評価などの条件で口コミの案内を出し分ける） | **実装する**。判定はサーバー（`postSurveyResponse`）だけで行う |
| 口コミ文面の生成（LLM） | **作らない**。案内画面には「Google に口コミを書く」ボタンだけを置き、編集画面の生成設定とテスト生成は隠す |
| 不正利用対策 | **レート制限だけ**入れる（同じ接続元から同じアンケートへ 10 分で 5 件まで）。App Check は本番公開の前に追加する |
| 下書きの保存 | callable `updateSurveyDraft` 経由（ルールの「書き込みは Functions のみ」を保つ） |
| 一時停止中の公開データ | `publicSurveys` を `status: 'paused'` で残し、回答画面で「受付停止中」を表示する |

### リスク（承知のうえで採用）

- **レビューゲーティング**：条件を満たした回答者だけに口コミ投稿を案内する使い方は、Google の口コミに関するポリシーで禁止されている「選択的な口コミの依頼」にあたるおそれがある。口コミの削除やビジネスプロフィールの停止につながる可能性がある。ユーザーの判断で実装する（I-01 / I-08 に記録する）。
- **App Check なし**：レート制限だけでは、多数の接続元からの自動送信は防げない。本番で公開する前に App Check（reCAPTCHA Enterprise）を追加する。

### 対象外

- 口コミ文面の生成（`createReviewDraft` / `createReviewDraftPreview`、LLM アダプタ）
- App Check
- ダッシュボード、利用量の画面、日別集計（`dailyStats`）— ② で扱う
- 組織の利用停止時の連動（本物の Functions に運営機能がまだないため）
- 回答一覧のサーバー側ページ分割（件数が増えてから）
- アンケートの削除（今のモックにもない。終了が最後の状態）

## 1. データの置き場所

| パス | 内容 | 書き込み | 読み取り |
| --- | --- | --- | --- |
| `organizations/{orgId}/surveys/{surveyId}` | 既存の `Survey` 型（`storeId`・`title`・`status`・`publicSlug`・`draft`・`currentVersion`・`hasUnpublishedChanges`・`publishPeriod`・`createdAt`・`updatedAt`） | Functions のみ | メンバー（staff は担当店舗のみ） |
| `organizations/{orgId}/surveyVersions/{surveyId}_{n}` | 既存の `SurveyVersion` 型に `storeId` を加えたもの。公開時の内容（変更しない） | Functions のみ | 同上 |
| `organizations/{orgId}/responses/{submissionId}` | 既存の `SurveyResponse` 型に `ipHash` を加えたもの。`reviewDraft` は常に `null` | Functions のみ | 同上 |
| `publicSurveys/{slug}` | 既存の `PublicSurvey` 型（遷移ルール・生成設定・`reviewUrl` は含めない） | Functions のみ | **誰でも slug を指定して 1 件読める**（未ログインでも `get` 可。一覧 `list` は不可） |
| `rateLimits/{slug}_{ipHash}` | `{ hits: Timestamp[] }`（直近 10 分の受付時刻） | Functions のみ | 全員拒否 |
| `organizations/{orgId}/usageMonthly/{YYYYMM}` | 既存。`responses` を加算する | Functions のみ | メンバー（既存のルール） |

- `docs/02-database.md` の設計からの変更点
  - バージョンをサブコレクションではなく、組織直下の `surveyVersions/{surveyId}_{n}` に置く。staff の絞り込み（`storeId in`）を、順位計測の `rankSnapshots` と同じ購読の仕組み（`watchStoreScoped`）で扱うため。
  - `rateLimits` を追加する。
  - 下書きも Functions 経由で保存する（docs ではクライアントから直接書く想定だった）。
- `SurveyResponse.ipHash` は画面の型には加えない。サーバーだけが使う。

## 2. Functions

### 2.1 管理側の callable（`functions/src/surveys/`、ログイン必須）

権限はモックと同じ「組織のメンバー。staff は担当店舗（`requireStoreAccess`）のみ」とする。

| ハンドラー | export 名 | 内容 |
| --- | --- | --- |
| `createSurveyFunc` | `createSurvey` | 作成する。`status !== 'closed'` の件数で `maxSurveys` を判定する（トランザクション内の `.count()`）。slug を発行する。初期状態は `draft` |
| `createSurveyCopyFunc` | `createSurveyCopy` | 元のアンケートの `draft` を複製する（別の店舗も指定できる）。件数の判定は作成と同じ |
| `updateSurveyDraftFunc` | `updateSurveyDraft` | 下書き（`title`・`draft`）を保存する。設問の形と文字数を検証し、公開版があれば `hasUnpublishedChanges: true` にする |
| `updateSurveyPublishFunc` | `updateSurveyPublish` | 公開・変更の公開。モックの検証（`surveys.ts:42-57`）を移し、1 つのトランザクションで次の 3 つを行う：`surveyVersions/{id}_{n+1}` を作る、`status`・`currentVersion`・`hasUnpublishedChanges` を更新する、`publicSurveys/{slug}` を作り直す。`closed` は不可 |
| `updateSurveyStatusFunc` | `updateSurveyStatus` | `pause` / `resume` / `close`。状態の移り方はモック（`surveys.ts:115-119`）のとおり。`pause` は `publicSurveys.status = 'paused'`、`resume` は `published` に戻す、`close` は `publicSurveys` を削除する |
| `updateSurveySlugFunc` | `updateSurveySlug` | slug を再発行する。古い `publicSurveys` を削除し、公開中・停止中なら新しい slug で作り直す。`closed` は不可 |
| `updateSurveyPeriodFunc` | `updateSurveyPeriod` | 公開期間を変える（終了 > 開始）。`publicSurveys` があれば反映する |
| `getResponsesCsvFunc` | `getResponsesCsv` | 入力は `{ orgId, surveyId, storeId?, from?, to? }`。サーバー側で回答を検索し直す（最大 5,000 件、超えたら `resource-exhausted`）。列の組み立てはモック（`responses.ts:147`）の規則（バージョンをまたいで設問 ID で列をそろえる）を移す。文面の列は出さない |

### 2.2 回答側の callable（`functions/src/responses/`、ログイン不要）

`shared/callable.ts` の `publicCallable` を拡張し、ハンドラーに接続元の IP（`request.rawRequest.ip`）を渡せるようにする。

| ハンドラー | export 名 | 内容 |
| --- | --- | --- |
| `postSurveyResponseFunc` | `postSurveyResponse` | 回答を受け付ける（2.3） |
| `postReviewRedirectFunc` | `postReviewRedirect` | 入力は `{ slug, submissionId }`。`isEligible` の回答に限って `redirectedAt` を記録する（記録済みなら何もしない） |

### 2.3 `postSurveyResponse`

入力は `{ slug, submissionId, answers }`。返す値は `{ responseId, isEligible, reviewUrl: string | null }`。1 つのトランザクションで次を行う。

1. `responses/{submissionId}` が既にあれば、保存済みの `isEligible` を返す（再送しても 1 件）。`reviewUrl` は回答に保存しないので、7 と同じく店舗から読んで返す。
2. `publicSurveys/{slug}` が `published` で、公開期間内であることを確かめる。満たさなければ `failed-precondition`（文言はモックと同じ）。
3. `surveyVersions/{surveyId}_{version}` の設問で回答を検証する（モックの `validateAnswers` を移す：必須、評価の範囲、選択肢の ID、自由記述 500 字まで）。
4. **レート制限**：`rateLimits/{slug}_{ipHash}` の `hits` から 10 分より古いものを除き、5 件以上なら `resource-exhausted`「短時間に多くの回答が送られました。しばらくしてから再度お試しください。」。そうでなければ今回の時刻を加える。
5. 公開版の `redirectRule` で `evaluateRedirectRule` を判定し、`isEligible` を決める。
6. 回答を作成し、`usageMonthly.responses` を加算する。
7. `isEligible` のときだけ、店舗の `reviewUrl` を返す。

- `ipHash` は `SHA-256(IP_HASH_SALT + ':' + ip)` の 16 進数とする。IP がとれない場合は `'unknown'` をハッシュする。`IP_HASH_SALT` は環境変数で、未設定なら Emulator では固定値、本番ではエラーにする（`shared/secrets.ts` の `FUNCTIONS_EMULATOR` の判定に合わせる）。
- 遷移ルールの判定関数は、`app/utils/evaluateRedirectRule.ts` を `functions/src/responses/evaluateRedirectRule.ts` に移す。モックは引き続き app 側のものを使う。

### 2.4 既存の処理の修正

- `stores/stores.ts` の `updateStoreArchiveFunc`：店舗をアーカイブしたら、その店舗の `published` / `paused` のアンケートを `closed` にし、`publicSurveys` を削除する。アーカイブは元に戻せない（戻す関数がなく、アーカイブ済みの店舗では公開もできない）ため、一時停止ではなく終了にして件数の上限からも外す。モック（`google.ts:116-126`）は一時停止にしているが、モックの既存動作は変えない。

## 3. 画面と購読

### 3.1 composable

`useSurveys`・`useSurveyEditor`・`useSurveyPublish`・`usePublicSurvey`・`useResponses`・`useResponseStats`・`useReviewDraft` を、既存の本接続済みの composable と同じ形にする。

- 読み込みは `useAppDb()` から（`useMockDb()` を直接使わない）。
- 書き込みは `isMock` で分け、本物モードでは `callFunction` を呼ぶ。モックモードの動作は変えない。
- `useSurveyEditor` の自動保存（800ms）は、本物モードでは `updateSurveyDraft` を呼ぶ。

### 3.2 購読（`useFirestoreSync`）

| コレクション | 条件 |
| --- | --- |
| `surveys` | 組織のものをすべて（`watchStoreScoped`） |
| `surveyVersions` | 組織のものをすべて（`watchStoreScoped`） |
| `responses` | 直近 90 日（`createdAt >= `）・新しい順・2,000 件まで（`watchStoreScoped`） |

- 回答一覧の画面に「直近 90 日・最大 2,000 件を表示しています。それより前は CSV で確認してください」と表示する。
- `publicSurveys` は購読しない（管理側では使わない）。

### 3.3 回答画面（`/s/[slug]`、未ログイン）

- 本物モードでは `publicSurveys/{slug}` を `getDoc` で 1 件読む。モックモードは今のまま。
- 表示の分岐：`published` かつ期間内なら回答フォーム、`paused` なら「受付停止中」、期間外なら「受付期間外」、ドキュメントがなければ「見つかりません」。
- 送信は、今と同じく sessionStorage の `submissionId` を使って `postSurveyResponse` を呼ぶ。`isEligible` なら `/s/[slug]/review` へ、そうでなければ `/s/[slug]/thanks` へ進む。
- `/s/[slug]/review` は、`postSurveyResponse` が返した `reviewUrl` を sessionStorage から読み、「Google に口コミを書く」ボタンを表示する。押したら `postReviewRedirect` を呼んで、`reviewUrl` を開く。文面の生成・コピーの部分は表示しない。
- `reviewUrl` が手元にない（直接 URL を開いた、など）場合は、回答画面に戻す（今の `review.vue` と同じ扱い）。

### 3.4 編集画面

- 遷移ルールの設定はそのまま使う。
- 口コミ文面の生成設定（`reviewDraftSettings`）と「テスト生成」は、モック・本物モードとも表示しない。設定の値は型に残し、保存時はそのまま保持する。

### 3.5 本接続の範囲

- `useAdminNav.ts` の `FIREBASE_READY_PATHS` に `/surveys` を加える。
- 回答画面（`/s/**`）はもともと「準備中」の判定の対象外なので、変更は不要。

## 4. ルールとインデックス

### 4.1 `firestore.rules`

- `organizations/{orgId}/surveys/{id}`・`surveyVersions/{id}`・`responses/{id}`：`allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);`
- `publicSurveys/{slug}`：`allow get: if true;`（slug を指定した 1 件のみ。`list` は許可しない。全組織のアンケートを一覧できないようにするため。2026-10-08 の最終レビューで変更）
- `rateLimits`：記載しない（全員拒否）
- 書き込みはすべて許可しない（Functions の Admin SDK だけが書く）

### 4.2 `firestore.indexes.json`

- `responses (storeId ASC, createdAt DESC)`：staff の購読
- `responses (surveyId ASC, createdAt DESC)`：CSV の検索
- `responses (surveyId ASC, storeId ASC, createdAt DESC)`：CSV の検索（店舗の指定あり）
- `surveys` と `surveyVersions` の `storeId in` は、等価条件だけなので自動インデックスで足りる

## 5. テスト

| 対象 | 種類 | 観点 |
| --- | --- | --- |
| `evaluateRedirectRule` | 単体 | 演算子 7 種、and / or、条件 0 件は false、未回答は満たさない |
| 回答の検証 | 単体 | 必須、評価・NPS の範囲、選択肢 ID、自由記述 500 / 501 文字 |
| 下書き・公開の検証 | 単体 | モック `surveys.ts:42-57` の規則 |
| 状態の移り方 | 単体 | `draft` / `published` / `paused` / `closed` × `pause` / `resume` / `close` |
| CSV の組み立て | 単体 | バージョンをまたいだ列の整列、カンマ・改行・引用符のエスケープ |
| IP のハッシュ | 単体 | 同じ入力で同じ値、ソルトで値が変わる |
| 管理側の callable | Emulator 結合 | 権限（staff は担当外を拒否）、`maxSurveys`、公開でバージョンが増え `publicSurveys` が作り直される、停止で `paused`、終了で削除、slug の再発行、期間、店舗アーカイブでの終了 |
| `postSurveyResponse` | Emulator 結合 | 同じ `submissionId` の再送で 1 件、期間外・停止中は拒否、レート制限の 5 件目は通り 6 件目は拒否、`isEligible` のときだけ `reviewUrl` が返る、使用回数の加算 |
| ルール | ルールテスト | `publicSurveys` は未ログインで slug 指定の 1 件は読めるが一覧と書き込みはできない、staff は担当外の回答を読めない、`rateLimits` は読めない |
| 画面 | 手動（Playwright） | モックモードの既存動作。`npm run dev:emulator` で作成 → 公開 → 未ログインで回答 → 案内 → 回答一覧 → CSV |

## 6. ドキュメントの更新

- `docs/02-database.md`：1 章の置き場所の変更（`surveyVersions` を組織直下に、`rateLimits` の追加、下書きは Functions 経由）
- `docs/04-features.md`：F-08〜F-14（文面生成は今回作らない、遷移ルールはサーバーで判定、レート制限、App Check は後で）
- `docs/05-open-issues.md`：I-01 / I-08 に「遷移ルールはリスクを承知で実装（2026-10-08）」、I-06 に「文面生成は今回作らない」
- `.claude/PROJECT.md`：`IP_HASH_SALT`、本接続した画面、新しいコレクション、Functions のフォルダ（`surveys/`・`responses/`）
