# アンケートの管理と回答受付 本接続 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アンケートの管理画面と公開アンケート（未ログインの回答画面）を、モックから Firebase（Firestore + Cloud Functions）に本接続する。

**Architecture:**
- Functions に `surveys/`（管理側の callable と CSV）と `responses/`（回答側の callable）を新設する。
  - 判定・検証・状態の移り方・CSV・IP のハッシュ・レート制限は純粋関数にして単体テストする。
  - Firestore を書く処理は Emulator の結合テストで確かめる。
- 公開・状態の変更・slug の再発行・期間の変更は、1 つのトランザクションで `surveys`・`surveyVersions`・`publicSurveys` をそろえる（`writePublicSurvey` に集約）。
- 回答の受付（`postSurveyResponse`）は、再送の重複防止・公開状態と期間・回答の検証・レート制限・遷移ルールの判定・保存・使用回数の加算を 1 つのトランザクションで行う。
  - 現在時刻と IP ハッシュのソルトは `ResponseDeps` で差し替えられるようにする。
- 画面は既存の `useAppDb` と `useFirestoreSync`（`watchStoreScoped`）で `surveys` / `surveyVersions` / `responses` を購読する。
  - 書き込みは `isMock` で分け、本物モードでは `callFunction` を呼ぶ。
  - 回答画面は `publicSurveys/{slug}` を `getDoc` で 1 回だけ読む。
- 口コミ文面の生成は作らない。案内画面は「Google に口コミを書く」ボタンだけにし、編集画面の生成設定とテスト生成は隠す。

**Tech Stack:** firebase-functions 7（onCall）/ firebase-admin 13（Firestore のトランザクション・`count()`）/ node:crypto（SHA-256）/ Nuxt 4 / firebase 12（Web SDK の `getDoc`・`onSnapshot`）/ Tailwind v4

**Spec:** `docs/superpowers/specs/2026-10-08-surveys-integration-design.md`

**前提（既存）:**
- Functions 側
  - `callable(handler, options)` / `publicCallable(handler)`（`functions/src/shared/callable.ts`）
  - `fail`（`shared/errors.ts`）
  - `asObject` / `requireString` / `requireId` / `requireOneOf`（`shared/validation.ts`）
  - `requireOrg` / `requireMember`（tx を渡せる）/ `requireStoreAccess` / `MemberDoc`（`shared/members.ts`）
  - `writeAuditLog`（`shared/audit.ts`）
  - `commitWrites` / `WriteOp`（`shared/firestoreWrites.ts`）
  - `toJstMonthKey`（`rankings/validation.ts`）
- テスト用
  - `getTestDb` / `clearFirestore` / `caller` / `seedOrg` / `seedStore`（`functions/src/__tests__/emulator.ts`）
  - `seedOrg` の `limits.maxSurveys` は 30。`seedStore` は `{ orgId, name, status: 'active' }` だけを書く（`reviewUrl` は無い）
- 画面側
  - `useAppDb` / `useMockDb` / `useFirestoreSync`（`watchStoreScoped` / `MirrorCollection`）
  - `callFunction`（`app/utils/firebase/callFunction.ts`）
  - `toIso`（`app/utils/firebase/converters.ts`）
  - `useActionState` / `useToast` / `useCurrentOrg` / `useAuth`
  - `cloneData`（`app/utils/cloneData.ts`。JSON による深いコピー）
  - `errorMessageOf` / `mockLatency`（`app/utils/mock/functions/shared.ts`）
  - `FIREBASE_READY_PATHS`（`app/composables/useAdminNav.ts:29`）
- 既存の画面
  - `app/pages/admin/[orgId]/surveys/index.vue` / `new.vue` / `[surveyId]/index.vue` / `[surveyId]/edit.vue` / `[surveyId]/responses.vue`
  - `app/pages/s/[slug]/index.vue` / `review.vue` / `thanks.vue`
  - `app/components/SurveyEditor/Edit/*.vue`（`DraftSettings.vue` が生成設定とテスト生成）
- モック（変更しない。モックモードでは引き続きこれを使う）
  - `app/utils/mock/functions/surveys.ts` / `responses.ts` / `google.ts`
  - `app/utils/evaluateRedirectRule.ts`（コメントだけ直す）

## Global Constraints

**判定と生成**
- 遷移ルール（評価などの条件で口コミの案内を出し分ける）は**実装する**。判定はサーバー（`postSurveyResponse`）だけで行う。
- `publicSurveys` には遷移ルール・生成設定・`reviewUrl` を含めない。
- 口コミ文面の生成（LLM）は**作らない**。`createReviewDraft` / `createReviewDraftPreview` / LLM アダプタは作らない。`SurveyResponse.reviewDraft` は常に `null`。
- 案内画面（`/s/[slug]/review`）には「Google に口コミを書く」ボタンだけを置く。文面の生成・コピーの部分は表示しない。
- 編集画面の口コミ文面の生成設定（`reviewDraftSettings`）と「テスト生成」は、モック・本物モードとも表示しない。設定の値は型に残し、保存時はそのまま保持する。
  - 設問ごとの「口コミ下書きの材料に使う」（`useForReviewDraft`）も生成の設定なので表示しない（値は残す）。
  - 表示しなくなる `DraftSettings.vue` と `useSurveyEditor` の `previewReviewDraft` は、未使用のコードを残さない規則（CLAUDE.md）に従って削除する。モックの Functions（`createReviewDraftFunc` / `createReviewDraftPreviewFunc`）も、参照が 0 件になったら削除する（下の項目）。
  - 案内画面もモック・本物モードとも、ボタンだけにする（モックで文面を出すと、編集画面で設定できない文面が出るため）。

**データの配置**

| パス | 内容 | 書き込み | 読み取り |
| --- | --- | --- | --- |
| `organizations/{orgId}/surveys/{surveyId}` | `orgId, storeId, title, status, publicSlug, draft, currentVersion, hasUnpublishedChanges, publishPeriod { startAt, endAt }, createdAt, updatedAt` | Functions のみ | メンバー（staff は担当店舗のみ） |
| `organizations/{orgId}/surveyVersions/{surveyId}_{n}` | `orgId, surveyId, storeId, version, content, publishedBy, publishedAt`（公開時の内容。変更しない） | Functions のみ | 同上 |
| `organizations/{orgId}/responses/{submissionId}` | `orgId, surveyId, storeId, surveyVersion, answers, isEligible, reviewDraft: null, redirectedAt, createdAt, ipHash` | Functions のみ | 同上 |
| `publicSurveys/{slug}` | `slug, orgId, surveyId, storeId, version, storeName, questions, design, status('published'\|'paused'), publishPeriod` | Functions のみ | **誰でも**（未ログインでも `get` / `list` 可） |
| `rateLimits/{slug}_{ipHash}` | `{ hits: Timestamp[] }`（直近 10 分の受付時刻） | Functions のみ | 全員拒否（ルールに記載しない） |
| `organizations/{orgId}/usageMonthly/{YYYYMM}` | 既存。`responses` を `FieldValue.increment(1)` で加算する（月は JST、`toJstMonthKey`） | Functions のみ | メンバー（既存のルール） |

- 公開期間は Firestore では `Timestamp | null`、画面の型では ISO 文字列 `| null`。
- `SurveyResponse.ipHash` は画面の型（`app/types/domain.ts`）には加えない。

**回答の受付**
- 入力は `{ slug, submissionId, answers }`、返す値は `{ responseId, isEligible, reviewUrl: string | null }`。`responseId` は `submissionId` と同じ。
- 同じ `submissionId` の再送は保存済みの `isEligible` を返す（再送しても 1 件）。`reviewUrl` は回答に保存せず、店舗から読んで返す。
- `publicSurveys/{slug}` が無い・`published` でない：`failed-precondition`「現在このアンケートは受け付けていません。」
- 公開期間外：`failed-precondition`「回答の受付期間外です。」
- 回答の検証（公開版 `surveyVersions/{surveyId}_{version}` の設問で行う）
  - 必須：`invalid-argument`「「{設問文}」は必須です。」
  - 評価（1〜5 の整数）・おすすめ度（0〜10 の整数）の範囲外：`invalid-argument`「評価の値が不正です。」
  - 選択肢の ID が公開版に無い：`invalid-argument`「選択肢の値が不正です。」
  - 自由記述は前後の空白を除いて **500 字まで**：`invalid-argument`「自由記述は 500 文字以内で入力してください。」
- **レート制限**：同じ接続元から同じアンケートへ **10 分で 5 件まで**。`rateLimits/{slug}_{ipHash}` の `hits` から 10 分より古いものを除き、5 件以上なら `resource-exhausted`「短時間に多くの回答が送られました。しばらくしてから再度お試しください。」。そうでなければ今回の時刻を加える。
- `isEligible` のときだけ店舗の `reviewUrl` を返す。
- **ipHash**：`SHA-256(IP_HASH_SALT + ':' + ip)` の 16 進数（64 文字）。IP がとれない場合は `'unknown'` をハッシュする。IP は `request.rawRequest.ip`（`publicCallable` を拡張して渡す）。
- **IP_HASH_SALT**：環境変数。未設定なら Emulator（`process.env.FUNCTIONS_EMULATOR === 'true'`）では固定値 `meo-tool-local-ip-salt`、本番では `failed-precondition`「現在このアンケートは回答を受け付けられません。運営にお問い合わせください。」。
- `postReviewRedirect` の入力は `{ slug, submissionId }`。`isEligible` の回答に限って `redirectedAt` を記録する（記録済みなら何もしない）。対象が無くてもエラーにしない。

**管理側**
- 権限はモックと同じ「組織のメンバー。staff は担当店舗（`requireStoreAccess`）のみ」。管理側はログイン必須（`callable`）、回答側はログイン不要（`publicCallable`）。
- 件数の上限：`status !== 'closed'` の件数で `maxSurveys` を判定する（トランザクション内の `.count()`）。`resource-exhausted`「アンケート数の上限（{maxSurveys} 件）に達しています。」
- 状態の移り方（モック `surveys.ts:115-119`）：`pause` は `published → paused`、`resume` は `paused → published`、`close` は `published / paused → closed`。それ以外は `failed-precondition`「この状態からは変更できません。」
  - `pause` で `publicSurveys.status = 'paused'`、`resume` で `published`、`close` で `publicSurveys` を削除する。
- 公開：`closed` は `failed-precondition`「終了したアンケートは公開できません。」。公開前の検証（モック `surveys.ts:42-57`）で問題があれば、メッセージを `\n` でつないで `failed-precondition`。
- slug の再発行：`closed` は `failed-precondition`「終了したアンケートの URL は再発行できません。」
- 公開期間：終了 > 開始。満たさなければ `invalid-argument`「終了日時は開始日時より後にしてください。」
- 下書きの保存：`closed` は `failed-precondition`「終了したアンケートは編集できません。」
- タイトルは 1〜60 文字。複製のタイトルは `{元のタイトル}（コピー）`（60 文字を超える分は元のタイトルの末尾を切る）。
- CSV：入力は `{ orgId, surveyId, storeId?, from?, to? }`。サーバー側で回答を検索し直す（**最大 5,000 件**、超えたら `resource-exhausted`「CSV は 5000 件までです。期間を絞ってください。」）。列はバージョンをまたいで設問 ID でそろえる。**文面の列は出さない**。
- 店舗のアーカイブ（`updateStoreArchiveFunc`）：その店舗の `published` / `paused` のアンケートを `closed` にし、`publicSurveys` を削除する。

**画面**
- 購読：`surveys` と `surveyVersions` は組織のものをすべて、`responses` は**直近 90 日**（`createdAt >=`）・新しい順・**2,000 件まで**（いずれも `watchStoreScoped`）。`publicSurveys` は購読しない。
- 回答一覧（本物モード）に「直近 90 日・最大 2,000 件を表示しています。それより前は CSV で確認してください」と表示する。
- `useSurveyEditor` の自動保存（800ms）は、本物モードでは `updateSurveyDraft` を呼ぶ。
- 回答画面（`/s/[slug]`）の表示：`published` かつ期間内なら回答フォーム、`paused` なら「受付停止中」、期間外なら「受付期間外」、ドキュメントがなければ「見つかりません」。
- `FIREBASE_READY_PATHS` に `/surveys` を加える。回答画面（`/s/**`）は「準備中」の判定の対象外なので変更しない。

**その他**
- region は `setGlobalOptions` の `asia-northeast1` のまま。新しい関数に個別の region は付けない。
- App Check は入れない（本番公開の前に別途追加する）。
- モックモード（`NUXT_PUBLIC_USE_MOCK` 未設定）の既存動作を壊さない。モックの Functions（`app/utils/mock/functions/*.ts`）は変更しない。
- 対象外：口コミ文面の生成、App Check、ダッシュボード・利用量の画面・`dailyStats`、組織の利用停止時の連動、回答一覧のサーバー側ページ分割、アンケートの削除。
- コミットはユーザーの許可がある場合のみ（現状: その場で実装・コミットなし）。各タスクの最後は確認手順にする。

- 文面の生成をやめたことで、どこからも呼ばれなくなるモックの関数・部品（`createReviewDraftFunc`・`createReviewDraftPreviewFunc`・`ReviewDraftResult`・`app/utils/mock/reviewDraft.ts` など）は、参照が 0 件になったタスクの中で削除する（CLAUDE.md「後方互換のためだけの未使用コード・ダミー実装を残さない」）。削除する前に `grep -rn` で参照が 0 件であることを確かめる。型（`ReviewDraftSettings`・`SurveyResponse.reviewDraft`）は仕様 3.4 のとおり残す。

## Review Focus

| # | 起こりうること | 期待する動き | テストを置くタスク |
| --- | --- | --- | --- |
| 1 | 本物モードで作成・複製した直後に編集画面へ移る（Firestore の購読がまだ届いていない） | 「アンケートが見つかりません」を出さず、届いてから編集画面へ移る。下書きは届いた内容で始まり、読み込んだだけでは自動保存しない | Task 11（作成・複製の待ち合わせ）、Task 13（下書きの読み込み）。確認は Task 14 Step 1 の手動確認 |
| 2 | 回答の送信直後に受付が一時停止され、回答者が通信エラーで同じ回答を再送する | 停止のエラーにせず、保存済みの結果を返す（1 件のまま） | Task 7 |
| 3 | 自由記述が空白・改行だけ（必須の設問を含む） | 未回答として扱う。必須なら「必須です」、任意なら保存しない。「回答がある」の条件は満たさない | Task 2 |
| 4 | 回答画面を開いている間に「変更を公開」され、削除された設問の回答が届く | 公開版に無い設問 ID の回答は捨てて受け付ける | Task 2 |
| 5 | 自由記述が `=` `+` `-` `@` で始まり、ダウンロードした CSV を Excel で開く | 数式として実行されないよう、先頭に `'` を付けて文字列として出す | Task 3 |

---

## ファイル構成

**Functions**（`functions/src/`）

| ファイル | 責務 |
| --- | --- |
| `surveys/types.ts` | `SurveyStatus` / `SurveyStatusAction` / `Question` / `RedirectRule` / `SurveyContent` / `Answers` / `PublishPeriod` など |
| `surveys/content.ts` | `requireSurveyContent`（下書きの形と文字数）/ `validateSurveyForPublish`（公開前の検証）/ 上限の定数 |
| `surveys/status.ts` | `nextSurveyStatus` / `isPublicStatus` |
| `surveys/slug.ts` | `createSlug` |
| `surveys/period.ts` | `requirePublishPeriod` / `parseOptionalDate` / `toPeriod` / `isWithinPeriod` |
| `surveys/csv.ts` | `buildResponsesCsv` / `escapeCsvCell`（純粋関数） |
| `surveys/publicSurvey.ts` | `SurveyDoc` / `PublicSurveyDoc` / 参照の組み立て / `loadSurvey` / `readPublicSource` / `writePublicSurvey` |
| `surveys/surveys.ts` | 作成・複製・下書き・公開・状態・slug・期間の callable |
| `surveys/responsesCsv.ts` | `getResponsesCsvFunc` |
| `surveys/__tests__/sampleContent.ts` | テスト用のアンケートの中身 |
| `responses/evaluateRedirectRule.ts` | 遷移ルールの判定（`app/utils/evaluateRedirectRule.ts` を移したもの） |
| `responses/answers.ts` | `requireAnswers` |
| `responses/ipHash.ts` | `hashIp` / `getIpHashSalt` |
| `responses/rateLimit.ts` | `nextRateLimitHits` |
| `responses/usage.ts` | `addResponseUsage` |
| `responses/responses.ts` | `postSurveyResponseFunc` / `postReviewRedirectFunc` / `ResponseDeps` |
| `shared/callable.ts` | `publicCallable` に接続元の IP を渡す（`PublicContext` / `clientIpOf`） |
| `stores/stores.ts` | `updateStoreArchiveFunc` でアンケートを終了する |
| `index.ts` | export の追加 |

**ルール・インデックス**：`firestore.rules`、`firestore.indexes.json`、`functions/src/__tests__/firestore.rules.itest.ts`

**画面**

| ファイル | 責務 |
| --- | --- |
| `app/utils/firebase/converters.ts` | `toSurvey` / `toSurveyVersion` / `toSurveyResponse` / `toPublicSurvey` |
| `app/composables/useFirestoreSync.ts` | `surveys` / `surveyVersions` / `responses` の購読 |
| `app/composables/useSurveys.ts` / `useSurveyPublish.ts` / `useResponses.ts` | 管理側の読み書き |
| `app/composables/usePublicSurvey.ts` / `useReviewDraft.ts` | 回答画面の読み込み・送信・Google への遷移 |
| `app/composables/useSurveyEditor.ts` | 下書きの読み込みと自動保存 |
| `app/pages/s/[slug]/index.vue` / `review.vue` | 回答画面・案内画面 |
| `app/pages/admin/[orgId]/surveys/[surveyId]/edit.vue` / `responses.vue` | 編集画面・回答一覧 |
| `app/components/SurveyEditor/Edit/QuestionList.vue` | 「口コミ下書きの材料に使う」を表示しない |
| `app/components/SurveyEditor/Edit/DraftSettings.vue` | **削除**（生成設定とテスト生成） |
| `app/composables/useAdminNav.ts` | `FIREBASE_READY_PATHS` に `/surveys` |

- `app/utils/firebase/emptyDb.ts` は `surveys` / `surveyVersions` / `publicSurveys` / `responses` をすでに持つので変更しない（Task 10 で確認だけする）。
- `app/composables/useResponseStats.ts` は DB を読まない（引数の ref だけで集計する）ので変更しない。
- `app/composables/useStores.ts` の集計（`storeSummary`）は `useAppDb()` の `surveys` / `responses` を読んでいるので変更しない。
- 新しいコンポーネントは作らない。削除する `DraftSettings.vue` の呼び出し名は `<SurveyEditorEditDraftSettings />`（`edit.vue` だけが使う）。

---

### Task 1: アンケートの型・下書きと公開の検証・状態・slug・期間（純粋関数）

**Files:**
- Create: `functions/src/surveys/types.ts`
- Create: `functions/src/surveys/content.ts`
- Create: `functions/src/surveys/status.ts`
- Create: `functions/src/surveys/slug.ts`
- Create: `functions/src/surveys/period.ts`
- Create: `functions/src/surveys/__tests__/sampleContent.ts`
- Test: `functions/src/surveys/__tests__/content.test.ts`、`status.test.ts`、`slug.test.ts`、`period.test.ts`

**Interfaces:**
- Produces:
  - 型（`surveys/types.ts`）
    - `type SurveyStatus = 'draft' | 'published' | 'paused' | 'closed'`
    - `type SurveyStatusAction = 'pause' | 'resume' | 'close'`
    - `type QuestionType = 'rating' | 'nps' | 'single' | 'multi' | 'text'`
    - `interface QuestionOption { id: string; label: string }`
    - `interface Question { id: string; type: QuestionType; label: string; isRequired: boolean; options: QuestionOption[]; useForReviewDraft: boolean }`
    - `type Comparator = 'eq' | 'neq' | 'gte' | 'lte' | 'includes' | 'notIncludes' | 'notEmpty'`
    - `interface RedirectCondition { id: string; questionId: string; comparator: Comparator; value: number | string | null }`
    - `interface RedirectRule { operator: 'and' | 'or'; conditions: RedirectCondition[] }`
    - `interface ReviewDraftSettings { isEnabled: boolean; tone: 'casual' | 'polite'; length: 'short' | 'medium'; storeHighlights: string[]; ngWords: string[] }`
    - `interface SurveyDesign { intro: string; thanksMessage: string }`
    - `interface SurveyContent { questions: Question[]; redirectRule: RedirectRule; reviewDraftSettings: ReviewDraftSettings; design: SurveyDesign }`
    - `type AnswerValue = number | string | string[]`、`type Answers = Record<string, AnswerValue>`
    - `interface PublishPeriod { startAt: Date | null; endAt: Date | null }`
  - `surveys/content.ts`
    - `SURVEY_TITLE_MAX = 60`、`QUESTION_LIMIT = 20`、`OPTION_LIMIT = 10`、`CONDITION_LIMIT = 20`
    - `requireSurveyContent(value: unknown): SurveyContent`
    - `interface PublishStore { status: string; reviewUrl: string | null }`
    - `validateSurveyForPublish(content: SurveyContent, store: PublishStore | null): string[]`
  - `surveys/status.ts`
    - `nextSurveyStatus(current: SurveyStatus, action: SurveyStatusAction): SurveyStatus`
    - `isPublicStatus(status: SurveyStatus): status is 'published' | 'paused'`
  - `surveys/slug.ts`：`createSlug(): string`（10 文字）
  - `surveys/period.ts`
    - `interface StoredPeriod { startAt: Timestamp | Date | null; endAt: Timestamp | Date | null }`
    - `parseOptionalDate(value: unknown, label: string): Date | null`
    - `requirePublishPeriod(value: unknown): PublishPeriod`
    - `toPeriod(stored: StoredPeriod | undefined): PublishPeriod`
    - `isWithinPeriod(period: PublishPeriod, now: Date): boolean`
  - テスト用：`sampleContent(): SurveyContent`（`surveys/__tests__/sampleContent.ts`）

- [ ] **Step 1: 型を作る**

`functions/src/surveys/types.ts`:

```ts
// アンケート（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 1 章）の型。
// app/types/domain.ts の同名の型と同じ形。日時は Date（Firestore では Timestamp）で持つ

export type SurveyStatus = 'draft' | 'published' | 'paused' | 'closed'
export type SurveyStatusAction = 'pause' | 'resume' | 'close'

export type QuestionType = 'rating' | 'nps' | 'single' | 'multi' | 'text'

export interface QuestionOption {
  id: string
  label: string
}

export interface Question {
  id: string
  type: QuestionType
  label: string
  isRequired: boolean
  options: QuestionOption[]
  useForReviewDraft: boolean
}

export type Comparator = 'eq' | 'neq' | 'gte' | 'lte' | 'includes' | 'notIncludes' | 'notEmpty'

export interface RedirectCondition {
  id: string
  questionId: string
  comparator: Comparator
  value: number | string | null
}

export interface RedirectRule {
  operator: 'and' | 'or'
  conditions: RedirectCondition[]
}

/** 口コミ文面の生成設定。今回は生成を作らないが、値は保存時にそのまま残す */
export interface ReviewDraftSettings {
  isEnabled: boolean
  tone: 'casual' | 'polite'
  length: 'short' | 'medium'
  storeHighlights: string[]
  ngWords: string[]
}

export interface SurveyDesign {
  intro: string
  thanksMessage: string
}

/** 編集中の下書きと公開版で共通の中身 */
export interface SurveyContent {
  questions: Question[]
  redirectRule: RedirectRule
  reviewDraftSettings: ReviewDraftSettings
  design: SurveyDesign
}

export type AnswerValue = number | string | string[]
export type Answers = Record<string, AnswerValue>

export interface PublishPeriod {
  startAt: Date | null
  endAt: Date | null
}
```

テスト用の中身 `functions/src/surveys/__tests__/sampleContent.ts`:

```ts
import type { SurveyContent } from '../types'

/** テスト用のアンケート（星評価・複数選択・自由記述。星 4 以上で条件を満たす） */
export function sampleContent(): SurveyContent {
  return {
    questions: [
      { id: 'q-overall', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
      {
        id: 'q-good',
        type: 'multi',
        label: '良かった点',
        isRequired: false,
        options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
        useForReviewDraft: true,
      },
      { id: 'q-comment', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
    ],
    redirectRule: { operator: 'and', conditions: [{ id: 'c-1', questionId: 'q-overall', comparator: 'gte', value: 4 }] },
    reviewDraftSettings: { isEnabled: true, tone: 'polite', length: 'medium', storeHighlights: [], ngWords: ['日本一'] },
    design: { intro: 'ようこそ', thanksMessage: 'ありがとうございました' },
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/surveys/__tests__/content.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireSurveyContent, validateSurveyForPublish } from '../content'
import type { SurveyContent } from '../types'
import { sampleContent } from './sampleContent'

const invalid = { code: 'invalid-argument' }
const STORE = { status: 'active', reviewUrl: 'https://search.google.com/local/writereview?placeid=p-1' }

test('requireSurveyContent: 正しい下書きはそのまま返し、知らない項目は捨てる', () => {
  const content = sampleContent()
  assert.deepEqual(requireSurveyContent(content), content)
  const withExtra = { ...sampleContent(), extra: 'x', design: { ...content.design, color: 'red' } }
  assert.deepEqual(requireSurveyContent(withExtra), content)
})

test('requireSurveyContent: 編集途中の空の設問文・選択肢は保存できる', () => {
  const content = sampleContent()
  content.questions[0]!.label = ''
  content.questions[1]!.options[0]!.label = ''
  const saved = requireSurveyContent(content)
  assert.equal(saved.questions[0]!.label, '')
  assert.equal(saved.questions[1]!.options[0]!.label, '')
})

test('requireSurveyContent: 件数と文字数の上限', () => {
  const base = sampleContent()
  const question = base.questions[0]!
  const many = (count: number) => Array.from({ length: count }, (_, index) => ({ ...question, id: `q-${index}` }))
  assert.equal(requireSurveyContent({ ...base, questions: many(20) }).questions.length, 20)
  assert.throws(() => requireSurveyContent({ ...base, questions: many(21) }), { code: 'invalid-argument', message: '設問は 20 問までです。' })
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, label: 'あ'.repeat(101) }] }), { message: '設問文は 100 文字以内にしてください。' })
  const options = Array.from({ length: 11 }, (_, index) => ({ id: `o-${index}`, label: `${index}` }))
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...base.questions[1]!, options }] }), { message: '選択肢は 10 個までです。' })
  assert.throws(
    () => requireSurveyContent({ ...base, questions: [{ ...base.questions[1]!, options: [{ id: 'o-1', label: 'あ'.repeat(41) }] }] }),
    { message: '選択肢は 40 文字以内にしてください。' },
  )
  const conditions = Array.from({ length: 21 }, (_, index) => ({ id: `c-${index}`, questionId: 'q-overall', comparator: 'gte', value: 4 }))
  assert.throws(() => requireSurveyContent({ ...base, redirectRule: { operator: 'and', conditions } }), { message: '遷移条件は 20 件までです。' })
  assert.throws(() => requireSurveyContent({ ...base, design: { intro: 'あ'.repeat(201), thanksMessage: '' } }), { message: '案内文は 200 文字以内にしてください。' })
  const settings = { ...base.reviewDraftSettings, storeHighlights: ['a', 'b', 'c', 'd', 'e', 'f'] }
  assert.throws(() => requireSurveyContent({ ...base, reviewDraftSettings: settings }), { message: '店舗の特徴は 5 件までです。' })
})

test('requireSurveyContent: 形の誤り（種類・比較子・ID・重複 ID・値の型・配列でない）は拒否', () => {
  const base = sampleContent()
  const question = base.questions[0]!
  const rule = (condition: Record<string, unknown>) => ({ ...base, redirectRule: { operator: 'and', conditions: [condition] } })
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, type: 'date' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, id: 'q/1' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [question, question] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, isRequired: 'yes' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: 'x' }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, redirectRule: { operator: 'xor', conditions: [] } }), invalid)
  assert.throws(() => requireSurveyContent(rule({ id: 'c-1', questionId: 'q-overall', comparator: 'gt', value: 4 })), invalid)
  assert.throws(() => requireSurveyContent(rule({ id: 'c-1', questionId: 'q-overall', comparator: 'gte', value: [4] })), invalid)
  assert.throws(() => requireSurveyContent({ ...base, reviewDraftSettings: { ...base.reviewDraftSettings, tone: 'rude' } }), invalid)
  assert.throws(() => requireSurveyContent(null), invalid)
})

test('validateSurveyForPublish: 正しい内容と有効な店舗なら問題なし', () => {
  assert.deepEqual(validateSurveyForPublish(sampleContent(), STORE), [])
})

test('validateSurveyForPublish: モック（surveys.ts:42-57）と同じ規則', () => {
  const empty: SurveyContent = { ...sampleContent(), questions: [], redirectRule: { operator: 'and', conditions: [] } }
  assert.deepEqual(validateSurveyForPublish(empty, STORE), ['設問を 1 つ以上追加してください。', '遷移条件を 1 つ以上設定してください。'])

  const blank = sampleContent()
  blank.questions[0]!.label = '  '
  assert.deepEqual(validateSurveyForPublish(blank, STORE), ['設問文が空の設問があります。'])

  const choice = sampleContent()
  choice.questions[1]!.options = [choice.questions[1]!.options[0]!]
  assert.deepEqual(validateSurveyForPublish(choice, STORE), ['選択式の設問には選択肢を 2 つ以上設定してください。'])

  const orphan = sampleContent()
  orphan.redirectRule.conditions[0]!.questionId = 'q-deleted'
  assert.deepEqual(validateSurveyForPublish(orphan, STORE), ['遷移条件が削除済みの設問を参照しています。'])

  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, status: 'archived' }), ['店舗がアーカイブされているため公開できません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), null), ['店舗がアーカイブされているため公開できません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, reviewUrl: null }), ['店舗の口コミ URL が設定されていません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, reviewUrl: '' }), ['店舗の口コミ URL が設定されていません。'])
})
```

`functions/src/surveys/__tests__/status.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicStatus, nextSurveyStatus } from '../status'
import type { SurveyStatus, SurveyStatusAction } from '../types'

test('nextSurveyStatus: モック（surveys.ts:115-119）の移り方', () => {
  const allowed: [SurveyStatus, SurveyStatusAction, SurveyStatus][] = [
    ['published', 'pause', 'paused'],
    ['paused', 'resume', 'published'],
    ['published', 'close', 'closed'],
    ['paused', 'close', 'closed'],
  ]
  for (const [from, action, to] of allowed) assert.equal(nextSurveyStatus(from, action), to)
})

test('nextSurveyStatus: それ以外の 8 通りは failed-precondition', () => {
  const denied: [SurveyStatus, SurveyStatusAction][] = [
    ['draft', 'pause'], ['draft', 'resume'], ['draft', 'close'],
    ['published', 'resume'], ['paused', 'pause'],
    ['closed', 'pause'], ['closed', 'resume'], ['closed', 'close'],
  ]
  for (const [from, action] of denied) {
    assert.throws(() => nextSurveyStatus(from, action), { code: 'failed-precondition', message: 'この状態からは変更できません。' })
  }
})

test('isPublicStatus: 公開中と停止中だけが回答画面の公開データを持つ', () => {
  assert.deepEqual((['draft', 'published', 'paused', 'closed'] as SurveyStatus[]).map(isPublicStatus), [false, true, true, false])
})
```

`functions/src/surveys/__tests__/slug.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSlug } from '../slug'

test('createSlug: 紛らわしい文字（0 1 l o）を含まない 10 文字で、毎回変わる', () => {
  const slugs = new Set(Array.from({ length: 200 }, () => createSlug()))
  assert.equal(slugs.size, 200)
  for (const slug of slugs) assert.match(slug, /^[a-km-np-z2-9]{10}$/)
})
```

`functions/src/surveys/__tests__/period.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { isWithinPeriod, parseOptionalDate, requirePublishPeriod, toPeriod } from '../period'

const invalid = { code: 'invalid-argument' }

test('requirePublishPeriod: 未指定は null、ISO 文字列は Date にする', () => {
  assert.deepEqual(requirePublishPeriod({ startAt: null, endAt: null }), { startAt: null, endAt: null })
  assert.deepEqual(requirePublishPeriod({}), { startAt: null, endAt: null })
  assert.deepEqual(
    requirePublishPeriod({ startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-31T15:00:00.000Z' }),
    { startAt: new Date('2026-10-01T00:00:00.000Z'), endAt: new Date('2026-10-31T15:00:00.000Z') },
  )
})

test('requirePublishPeriod: 終了は開始より後。日時の形式が誤りなら拒否', () => {
  assert.throws(
    () => requirePublishPeriod({ startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-02T00:00:00Z' }),
    { code: 'invalid-argument', message: '終了日時は開始日時より後にしてください。' },
  )
  assert.throws(() => requirePublishPeriod({ startAt: 'あした', endAt: null }), { message: '公開期間の日時の形式が正しくありません。' })
  assert.throws(() => requirePublishPeriod({ startAt: '', endAt: null }), invalid)
  assert.throws(() => requirePublishPeriod({ startAt: 1, endAt: null }), invalid)
  assert.throws(() => requirePublishPeriod(null), invalid)
})

test('parseOptionalDate: null / undefined は null', () => {
  assert.equal(parseOptionalDate(undefined, '期間'), null)
  assert.equal(parseOptionalDate(null, '期間'), null)
  assert.throws(() => parseOptionalDate('x', '期間'), { message: '期間の日時の形式が正しくありません。' })
})

test('toPeriod: Timestamp・Date・未設定を Date | null にする', () => {
  const start = new Date('2026-10-01T00:00:00.000Z')
  assert.deepEqual(toPeriod({ startAt: Timestamp.fromDate(start), endAt: null }), { startAt: start, endAt: null })
  assert.deepEqual(toPeriod({ startAt: start, endAt: start }), { startAt: start, endAt: start })
  assert.deepEqual(toPeriod(undefined), { startAt: null, endAt: null })
})

test('isWithinPeriod: 開始前・終了後は期間外。開始・終了ちょうどは期間内', () => {
  const now = new Date('2026-10-08T01:00:00.000Z')
  const at = (ms: number) => new Date(now.getTime() + ms)
  assert.equal(isWithinPeriod({ startAt: null, endAt: null }, now), true)
  assert.equal(isWithinPeriod({ startAt: now, endAt: now }, now), true)
  assert.equal(isWithinPeriod({ startAt: at(1), endAt: null }, now), false)
  assert.equal(isWithinPeriod({ startAt: null, endAt: at(-1) }, now), false)
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL。`Cannot find module '../content'`（`../status`・`../slug`・`../period` も同様）でコンパイルが失敗する。

- [ ] **Step 4: 実装する**

`functions/src/surveys/content.ts`:

```ts
import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type {
  Comparator,
  Question,
  QuestionOption,
  QuestionType,
  RedirectCondition,
  ReviewDraftSettings,
  SurveyContent,
  SurveyDesign,
} from './types'

// アンケートの中身の検証。
// 下書きの保存では形と文字数だけを見て（編集途中の空の設問文は許す）、公開時に validateSurveyForPublish で中身を確かめる。
// 上限は編集画面の入力欄（maxlength・QUESTION_LIMIT など）と合わせる

export const SURVEY_TITLE_MAX = 60
export const QUESTION_LIMIT = 20
export const OPTION_LIMIT = 10
export const CONDITION_LIMIT = 20
const QUESTION_LABEL_MAX = 100
const OPTION_LABEL_MAX = 40
const DESIGN_TEXT_MAX = 200
const HIGHLIGHT_LIMIT = 5
const HIGHLIGHT_MAX = 30
const NG_WORD_LIMIT = 50
const NG_WORD_MAX = 20
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const QUESTION_TYPES: readonly QuestionType[] = ['rating', 'nps', 'single', 'multi', 'text']
const COMPARATORS: readonly Comparator[] = ['eq', 'neq', 'gte', 'lte', 'includes', 'notIncludes', 'notEmpty']
const SHAPE_ERROR = 'アンケートの内容の形式が正しくありません。'

function invalid(message = SHAPE_ERROR): never {
  return fail('invalid-argument', message)
}

/** 設問・選択肢・条件の ID */
function itemId(value: unknown): string {
  if (typeof value !== 'string' || !ITEM_ID_PATTERN.test(value)) invalid()
  return value
}

/** 空文字を許す文字列。上限を超えたら message で拒否する */
function text(value: unknown, max: number, message: string): string {
  if (typeof value !== 'string') invalid()
  if (value.length > max) invalid(message)
  return value
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid()
  return value
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid()
  return value as T
}

function list(value: unknown, maxItems: number, message: string): unknown[] {
  if (!Array.isArray(value)) invalid()
  if (value.length > maxItems) invalid(message)
  return value
}

function textList(value: unknown, maxItems: number, maxLength: number, label: string): string[] {
  return list(value, maxItems, `${label}は ${maxItems} 件までです。`)
    .map(item => text(item, maxLength, `${label}は 1 件 ${maxLength} 文字以内にしてください。`))
}

function readOption(value: unknown): QuestionOption {
  const input = asObject(value)
  return { id: itemId(input.id), label: text(input.label, OPTION_LABEL_MAX, `選択肢は ${OPTION_LABEL_MAX} 文字以内にしてください。`) }
}

function readQuestion(value: unknown): Question {
  const input = asObject(value)
  return {
    id: itemId(input.id),
    type: oneOf(input.type, QUESTION_TYPES),
    label: text(input.label, QUESTION_LABEL_MAX, `設問文は ${QUESTION_LABEL_MAX} 文字以内にしてください。`),
    isRequired: flag(input.isRequired),
    options: list(input.options, OPTION_LIMIT, `選択肢は ${OPTION_LIMIT} 個までです。`).map(readOption),
    useForReviewDraft: flag(input.useForReviewDraft),
  }
}

function readCondition(value: unknown): RedirectCondition {
  const input = asObject(value)
  const expected = input.value
  if (expected !== null && typeof expected !== 'number' && typeof expected !== 'string') invalid()
  return {
    id: itemId(input.id),
    questionId: itemId(input.questionId),
    comparator: oneOf(input.comparator, COMPARATORS),
    value: expected as number | string | null,
  }
}

function readSettings(value: unknown): ReviewDraftSettings {
  const input = asObject(value)
  return {
    isEnabled: flag(input.isEnabled),
    tone: oneOf(input.tone, ['casual', 'polite'] as const),
    length: oneOf(input.length, ['short', 'medium'] as const),
    storeHighlights: textList(input.storeHighlights, HIGHLIGHT_LIMIT, HIGHLIGHT_MAX, '店舗の特徴'),
    ngWords: textList(input.ngWords, NG_WORD_LIMIT, NG_WORD_MAX, 'NG ワード'),
  }
}

function readDesign(value: unknown): SurveyDesign {
  const input = asObject(value)
  const message = `案内文は ${DESIGN_TEXT_MAX} 文字以内にしてください。`
  return { intro: text(input.intro, DESIGN_TEXT_MAX, message), thanksMessage: text(input.thanksMessage, DESIGN_TEXT_MAX, message) }
}

/** 下書きの形と文字数を検証し、既知の項目だけを持つ値を返す */
export function requireSurveyContent(value: unknown): SurveyContent {
  const input = asObject(value)
  const questions = list(input.questions, QUESTION_LIMIT, `設問は ${QUESTION_LIMIT} 問までです。`).map(readQuestion)
  if (new Set(questions.map(question => question.id)).size !== questions.length) invalid()
  const rule = asObject(input.redirectRule)
  return {
    questions,
    redirectRule: {
      operator: oneOf(rule.operator, ['and', 'or'] as const),
      conditions: list(rule.conditions, CONDITION_LIMIT, `遷移条件は ${CONDITION_LIMIT} 件までです。`).map(readCondition),
    },
    reviewDraftSettings: readSettings(input.reviewDraftSettings),
    design: readDesign(input.design),
  }
}

export interface PublishStore {
  status: string
  reviewUrl: string | null
}

/** 公開前の検証（モック app/utils/mock/functions/surveys.ts の validateSurveyForPublish と同じ規則）。問題が無ければ空配列 */
export function validateSurveyForPublish(content: SurveyContent, store: PublishStore | null): string[] {
  const errors: string[] = []
  if (content.questions.length === 0) errors.push('設問を 1 つ以上追加してください。')
  if (content.questions.some(question => question.label.trim() === '')) errors.push('設問文が空の設問があります。')
  if (content.questions.some(question => (question.type === 'single' || question.type === 'multi') && question.options.length < 2)) {
    errors.push('選択式の設問には選択肢を 2 つ以上設定してください。')
  }
  if (content.redirectRule.conditions.length === 0) errors.push('遷移条件を 1 つ以上設定してください。')
  const questionIds = new Set(content.questions.map(question => question.id))
  if (content.redirectRule.conditions.some(condition => !questionIds.has(condition.questionId))) {
    errors.push('遷移条件が削除済みの設問を参照しています。')
  }
  if (!store || store.status !== 'active') errors.push('店舗がアーカイブされているため公開できません。')
  else if (!store.reviewUrl) errors.push('店舗の口コミ URL が設定されていません。')
  return errors
}
```

`functions/src/surveys/status.ts`:

```ts
import { fail } from '../shared/errors'
import type { SurveyStatus, SurveyStatusAction } from './types'

// 公開管理の状態の移り方（モック app/utils/mock/functions/surveys.ts の updateSurveyStatusFunc と同じ）

const TRANSITIONS: Record<SurveyStatusAction, { from: SurveyStatus[]; to: SurveyStatus }> = {
  pause: { from: ['published'], to: 'paused' },
  resume: { from: ['paused'], to: 'published' },
  close: { from: ['published', 'paused'], to: 'closed' },
}

export function nextSurveyStatus(current: SurveyStatus, action: SurveyStatusAction): SurveyStatus {
  const transition = TRANSITIONS[action]
  if (!transition.from.includes(current)) fail('failed-precondition', 'この状態からは変更できません。')
  return transition.to
}

/** 回答画面の公開データ（publicSurveys）を持つ状態 */
export function isPublicStatus(status: SurveyStatus): status is 'published' | 'paused' {
  return status === 'published' || status === 'paused'
}
```

`functions/src/surveys/slug.ts`:

```ts
import { randomBytes } from 'node:crypto'

// 回答画面の URL（/s/{slug}）に使う推測されにくい文字列。紛らわしい 0 1 l o を除いた 32 文字から選ぶ（256 を割り切るので偏らない）

const SLUG_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'
const SLUG_LENGTH = 10

export function createSlug(): string {
  return Array.from(randomBytes(SLUG_LENGTH), byte => SLUG_CHARS[byte % SLUG_CHARS.length]).join('')
}
```

`functions/src/surveys/period.ts`:

```ts
import type { Timestamp } from 'firebase-admin/firestore'
import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type { PublishPeriod } from './types'

// 公開期間。画面とは ISO 文字列でやり取りし、Firestore には Timestamp で保存する

type StoredDate = Timestamp | Date | null

/** Firestore から読んだ公開期間（書き込み直後の値は Date のこともある） */
export interface StoredPeriod {
  startAt: StoredDate
  endAt: StoredDate
}

/** 未指定（null / undefined）は null。それ以外は日時として読める文字列だけを受け付ける */
export function parseOptionalDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined) return null
  const date = typeof value === 'string' && value !== '' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) fail('invalid-argument', `${label}の日時の形式が正しくありません。`)
  return date
}

export function requirePublishPeriod(value: unknown): PublishPeriod {
  const input = asObject(value)
  const startAt = parseOptionalDate(input.startAt, '公開期間')
  const endAt = parseOptionalDate(input.endAt, '公開期間')
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) fail('invalid-argument', '終了日時は開始日時より後にしてください。')
  return { startAt, endAt }
}

function toDate(value: StoredDate | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : value.toDate()
}

export function toPeriod(stored: StoredPeriod | undefined): PublishPeriod {
  return { startAt: toDate(stored?.startAt), endAt: toDate(stored?.endAt) }
}

/** 開始・終了ちょうどは期間内（モックの isWithinPeriod と同じ） */
export function isWithinPeriod(period: PublishPeriod, now: Date): boolean {
  if (period.startAt && period.startAt.getTime() > now.getTime()) return false
  if (period.endAt && period.endAt.getTime() < now.getTime()) return false
  return true
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS（既存の単体テストもすべて PASS）

- [ ] **Step 6: 確認**

Run: `git status --short functions/src/surveys`
Expected: `types.ts`・`content.ts`・`status.ts`・`slug.ts`・`period.ts` と `__tests__/` の 5 ファイルが未追跡として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 2: 遷移ルールの判定・回答の検証・IP のハッシュ・レート制限（純粋関数）

**Files:**
- Create: `functions/src/responses/evaluateRedirectRule.ts`
- Create: `functions/src/responses/answers.ts`
- Create: `functions/src/responses/ipHash.ts`
- Create: `functions/src/responses/rateLimit.ts`
- Modify: `app/utils/evaluateRedirectRule.ts:3-4`（コメントのみ）
- Test: `functions/src/responses/__tests__/evaluateRedirectRule.test.ts`、`answers.test.ts`、`ipHash.test.ts`、`rateLimit.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Answers` / `AnswerValue` / `Question` / `RedirectRule` / `RedirectCondition`
- Produces:
  - `evaluateRedirectRule(rule: RedirectRule, answers: Answers): boolean`
  - `MAX_TEXT_LENGTH = 500`
  - `requireAnswers(questions: Question[], value: unknown): Answers`（公開版に無い設問 ID は捨て、空白だけの自由記述・空の複数選択は未回答にする）
  - `hashIp(salt: string, ip: string | null): string`
  - `getIpHashSalt(): string`
  - `RATE_LIMIT_WINDOW_MS = 600_000`、`RATE_LIMIT_MAX = 5`
  - `nextRateLimitHits(hits: Date[], now: Date): Date[]`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/responses/__tests__/evaluateRedirectRule.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RedirectCondition, RedirectRule } from '../../surveys/types'
import { evaluateRedirectRule } from '../evaluateRedirectRule'

function rule(operator: 'and' | 'or', ...conditions: Omit<RedirectCondition, 'id'>[]): RedirectRule {
  return { operator, conditions: conditions.map((condition, index) => ({ ...condition, id: `c-${index}` })) }
}

const one = (condition: Omit<RedirectCondition, 'id'>) => rule('and', condition)

test('演算子 7 種', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'eq', value: 5 }), { q: 5 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'eq', value: 5 }), { q: 4 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), { q: 4 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), { q: 5 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: 4 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: 3 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'lte', value: 2 }), { q: 2 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'lte', value: 2 }), { q: 3 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-a' }), { q: ['o-a', 'o-b'] }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-c' }), { q: ['o-a', 'o-b'] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-a' }), { q: 'o-a' }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-c' }), { q: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), { q: ['o-a'] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), { q: 'よかった' }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), {}), false)
})

test('and はすべて、or はいずれかを満たせば true', () => {
  const high = { questionId: 'q1', comparator: 'gte', value: 4 } as const
  const good = { questionId: 'q2', comparator: 'includes', value: 'o-a' } as const
  assert.equal(evaluateRedirectRule(rule('and', high, good), { q1: 5, q2: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(rule('and', high, good), { q1: 5, q2: ['o-b'] }), false)
  assert.equal(evaluateRedirectRule(rule('or', high, good), { q1: 1, q2: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(rule('or', high, good), { q1: 1, q2: ['o-b'] }), false)
})

test('条件 0 件は false', () => {
  assert.equal(evaluateRedirectRule(rule('and'), { q: 5 }), false)
  assert.equal(evaluateRedirectRule(rule('or'), { q: 5 }), false)
})

test('未回答の設問を参照する条件は満たさない（neq・notIncludes・空配列でも）', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), {}), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), {}), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), { q: [] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), { q: '' }), false)
})

test('gte / lte は数値でない回答・値を満たさない', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: '5' }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: '4' }), { q: 5 }), false)
})
```

`functions/src/responses/__tests__/answers.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Question } from '../../surveys/types'
import { requireAnswers } from '../answers'
import { evaluateRedirectRule } from '../evaluateRedirectRule'

const QUESTIONS: Question[] = [
  { id: 'q-rating', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
  { id: 'q-nps', type: 'nps', label: 'おすすめ度', isRequired: false, options: [], useForReviewDraft: false },
  {
    id: 'q-single',
    type: 'single',
    label: '来店回数',
    isRequired: false,
    options: [{ id: 'o-first', label: '初めて' }, { id: 'o-repeat', label: '2 回以上' }],
    useForReviewDraft: false,
  },
  {
    id: 'q-multi',
    type: 'multi',
    label: '良かった点',
    isRequired: false,
    options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
    useForReviewDraft: true,
  },
  { id: 'q-text', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
]
const RATED = { 'q-rating': 5 }

test('requireAnswers: 正しい回答を返す（自由記述は前後の空白を除き、複数選択の重複は 1 つに）', () => {
  assert.deepEqual(
    requireAnswers(QUESTIONS, { 'q-rating': 5, 'q-nps': 0, 'q-single': 'o-first', 'q-multi': ['o-taste', 'o-taste', 'o-service'], 'q-text': ' おいしかった ' }),
    { 'q-rating': 5, 'q-nps': 0, 'q-single': 'o-first', 'q-multi': ['o-taste', 'o-service'], 'q-text': 'おいしかった' },
  )
})

test('requireAnswers: 必須の設問が未回答なら「必須です」', () => {
  assert.throws(() => requireAnswers(QUESTIONS, {}), { code: 'invalid-argument', message: '「満足度」は必須です。' })
  assert.throws(() => requireAnswers(QUESTIONS, { 'q-rating': null }), { message: '「満足度」は必須です。' })
})

test('requireAnswers: 評価は 1〜5、おすすめ度は 0〜10 の整数', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { 'q-rating': 1, 'q-nps': 10 }), { 'q-rating': 1, 'q-nps': 10 })
  for (const value of [0, 6, 4.5, '5']) {
    assert.throws(() => requireAnswers(QUESTIONS, { 'q-rating': value }), { code: 'invalid-argument', message: '評価の値が不正です。' })
  }
  for (const value of [-1, 11]) {
    assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-nps': value }), { message: '評価の値が不正です。' })
  }
})

test('requireAnswers: 選択肢の ID は公開版にあるものだけ', () => {
  const error = { code: 'invalid-argument', message: '選択肢の値が不正です。' }
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-single': 'o-none' }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-single': ['o-first'] }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-multi': ['o-taste', 'o-none'] }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-multi': 'o-taste' }), error)
})

test('requireAnswers: 自由記述は 500 文字まで（501 文字は拒否）', () => {
  assert.equal(requireAnswers(QUESTIONS, { ...RATED, 'q-text': 'あ'.repeat(500) })['q-text'], 'あ'.repeat(500))
  assert.throws(
    () => requireAnswers(QUESTIONS, { ...RATED, 'q-text': 'あ'.repeat(501) }),
    { code: 'invalid-argument', message: '自由記述は 500 文字以内で入力してください。' },
  )
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-text': 123 }), { message: '自由記述の値が不正です。' })
})

test('requireAnswers: 空白だけの自由記述・空の複数選択は未回答として扱う（Review Focus 3）', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { ...RATED, 'q-text': ' \n　', 'q-multi': [], 'q-single': '' }), RATED)
  const requiredText: Question[] = [{ ...QUESTIONS[4]!, isRequired: true }]
  assert.throws(() => requireAnswers(requiredText, { 'q-text': '   ' }), { message: '「ご感想」は必須です。' })
  // 「回答がある」の条件も満たさない
  const notEmpty = { operator: 'and' as const, conditions: [{ id: 'c-1', questionId: 'q-text', comparator: 'notEmpty' as const, value: null }] }
  assert.equal(evaluateRedirectRule(notEmpty, requireAnswers(QUESTIONS, { ...RATED, 'q-text': '  ' })), false)
})

test('requireAnswers: 公開版に無い設問 ID の回答は捨てて受け付ける（Review Focus 4）', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { ...RATED, 'q-deleted': 3, 'q-old-text': 'x' }), RATED)
})

test('requireAnswers: 回答がオブジェクトでなければ拒否', () => {
  assert.throws(() => requireAnswers(QUESTIONS, null), { code: 'invalid-argument' })
  assert.throws(() => requireAnswers(QUESTIONS, [5]), { code: 'invalid-argument' })
})
```

`functions/src/responses/__tests__/ipHash.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getIpHashSalt, hashIp } from '../ipHash'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('hashIp: SHA-256(ソルト:IP) の 16 進数。同じ入力で同じ値、ソルトや IP で値が変わる', () => {
  const hash = hashIp('salt-a', '203.0.113.1')
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hash, sha256('salt-a:203.0.113.1'))
  assert.equal(hash, hashIp('salt-a', '203.0.113.1'))
  assert.notEqual(hash, hashIp('salt-b', '203.0.113.1'))
  assert.notEqual(hash, hashIp('salt-a', '203.0.113.2'))
})

test('hashIp: IP がとれない場合は unknown をハッシュする', () => {
  assert.equal(hashIp('salt-a', null), sha256('salt-a:unknown'))
})

test('getIpHashSalt: 環境変数を使い、未設定なら Emulator は固定値・本番はエラー', () => {
  const saved = { salt: process.env.IP_HASH_SALT, emulator: process.env.FUNCTIONS_EMULATOR }
  const restore = (key: 'IP_HASH_SALT' | 'FUNCTIONS_EMULATOR', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    process.env.IP_HASH_SALT = 'from-env'
    assert.equal(getIpHashSalt(), 'from-env')
    delete process.env.IP_HASH_SALT
    process.env.FUNCTIONS_EMULATOR = 'true'
    assert.equal(getIpHashSalt(), 'meo-tool-local-ip-salt')
    delete process.env.FUNCTIONS_EMULATOR
    assert.throws(() => getIpHashSalt(), {
      code: 'failed-precondition',
      message: '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。',
    })
  }
  finally {
    restore('IP_HASH_SALT', saved.salt)
    restore('FUNCTIONS_EMULATOR', saved.emulator)
  }
})
```

`functions/src/responses/__tests__/rateLimit.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRateLimitHits } from '../rateLimit'

const NOW = new Date('2026-10-08T01:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const TEN_MINUTES = 10 * 60 * 1000
const limited = { code: 'resource-exhausted', message: '短時間に多くの回答が送られました。しばらくしてから再度お試しください。' }

test('nextRateLimitHits: 10 分以内が 4 件までなら今回を加えて返す（5 件目は通る）', () => {
  assert.deepEqual(nextRateLimitHits([], NOW), [NOW])
  const four = [ago(4000), ago(3000), ago(2000), ago(1000)]
  assert.deepEqual(nextRateLimitHits(four, NOW), [...four, NOW])
})

test('nextRateLimitHits: 10 分以内が 5 件あれば拒否する（6 件目）', () => {
  assert.throws(() => nextRateLimitHits([5, 4, 3, 2, 1].map(n => ago(n * 1000)), NOW), limited)
})

test('nextRateLimitHits: 10 分より古い受付は数えずに捨てる（ちょうど 10 分前は数える）', () => {
  const old = ago(TEN_MINUTES + 1)
  const edge = ago(TEN_MINUTES)
  assert.deepEqual(nextRateLimitHits([old, edge], NOW), [edge, NOW])
  assert.deepEqual(nextRateLimitHits([old, old, old, old, old], NOW), [NOW])
  assert.throws(() => nextRateLimitHits([edge, ago(4), ago(3), ago(2), ago(1)], NOW), limited)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL。`Cannot find module '../evaluateRedirectRule'`（`../answers`・`../ipHash`・`../rateLimit` も同様）でコンパイルが失敗する。

- [ ] **Step 3: 実装する**

`functions/src/responses/evaluateRedirectRule.ts`（`app/utils/evaluateRedirectRule.ts` を移したもの。判定の中身は同じ）:

```ts
import type { AnswerValue, Answers, RedirectCondition, RedirectRule } from '../surveys/types'

// F-11 遷移ルールの判定（app/utils/evaluateRedirectRule.ts から移した。モックは引き続き app 側を使う）。
// 回答画面には遷移ルールを渡さないため、判定は postSurveyResponse だけで行う

function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === '') return true
  return Array.isArray(value) && value.length === 0
}

function evaluateCondition(condition: RedirectCondition, answers: Answers): boolean {
  const answer = answers[condition.questionId]
  if (condition.comparator === 'notEmpty') return !isEmptyAnswer(answer)
  // 未回答の設問を参照する条件は満たさない扱い
  if (isEmptyAnswer(answer) || answer === undefined) return false

  const expected = condition.value
  switch (condition.comparator) {
    case 'eq':
      return answer === expected
    case 'neq':
      return answer !== expected
    case 'gte':
      return typeof answer === 'number' && typeof expected === 'number' && answer >= expected
    case 'lte':
      return typeof answer === 'number' && typeof expected === 'number' && answer <= expected
    case 'includes':
      return Array.isArray(answer) ? answer.includes(String(expected)) : answer === expected
    case 'notIncludes':
      return Array.isArray(answer) ? !answer.includes(String(expected)) : answer !== expected
  }
}

export function evaluateRedirectRule(rule: RedirectRule, answers: Answers): boolean {
  if (rule.conditions.length === 0) return false
  const results = rule.conditions.map(condition => evaluateCondition(condition, answers))
  return rule.operator === 'and' ? results.every(Boolean) : results.some(Boolean)
}
```

`functions/src/responses/answers.ts`:

```ts
import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type { AnswerValue, Answers, Question } from '../surveys/types'

// F-10 回答の検証（モック app/utils/mock/functions/responses.ts の validateAnswers を移し、選択肢 ID の確認を加えた）

export const MAX_TEXT_LENGTH = 500

function invalid(message: string): never {
  return fail('invalid-argument', message)
}

function hasOption(question: Question, id: unknown): boolean {
  return typeof id === 'string' && question.options.some(option => option.id === id)
}

/** 1 問分の回答を検証し、保存する値を返す。未回答は undefined */
function readAnswer(question: Question, value: unknown): AnswerValue | undefined {
  if (value === undefined || value === null) return undefined
  switch (question.type) {
    case 'rating':
    case 'nps': {
      const [min, max] = question.type === 'rating' ? [1, 5] : [0, 10]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid('評価の値が不正です。')
      return value
    }
    case 'single': {
      if (value === '') return undefined
      if (!hasOption(question, value)) invalid('選択肢の値が不正です。')
      return value as string
    }
    case 'multi': {
      if (!Array.isArray(value) || !value.every(id => hasOption(question, id))) invalid('選択肢の値が不正です。')
      const ids = [...new Set(value as string[])]
      return ids.length > 0 ? ids : undefined
    }
    case 'text': {
      if (typeof value !== 'string') invalid('自由記述の値が不正です。')
      const text = value.trim()
      if (text.length > MAX_TEXT_LENGTH) invalid(`自由記述は ${MAX_TEXT_LENGTH} 文字以内で入力してください。`)
      // 空白だけの回答は未回答として扱う
      return text === '' ? undefined : text
    }
  }
}

/**
 * 公開版の設問で回答を検証し、保存する回答を返す。
 * 公開版に無い設問 ID の回答（回答中に変更が公開された場合など）は捨てる
 */
export function requireAnswers(questions: Question[], value: unknown): Answers {
  const input = asObject(value)
  const answers: Answers = {}
  for (const question of questions) {
    const answer = readAnswer(question, input[question.id])
    if (answer === undefined) {
      if (question.isRequired) invalid(`「${question.label}」は必須です。`)
      continue
    }
    answers[question.id] = answer
  }
  return answers
}
```

`functions/src/responses/ipHash.ts`:

```ts
import { createHash } from 'node:crypto'
import { fail } from '../shared/errors'

// 回答者の接続元は IP そのものを保存せず、ソルト付きのハッシュだけを使う（レート制限と回答の ipHash）

/** Emulator・テスト専用。コードに固定されているため本番では使わない */
const EMULATOR_SALT = 'meo-tool-local-ip-salt'

/** SHA-256(ソルト + ':' + IP) の 16 進数。IP がとれない場合は 'unknown' をハッシュする */
export function hashIp(salt: string, ip: string | null): string {
  return createHash('sha256').update(`${salt}:${ip ?? 'unknown'}`).digest('hex')
}

/** IP_HASH_SALT（環境変数）。未設定なら Emulator は固定値、本番は受け付けない（secrets.ts の判定に合わせる） */
export function getIpHashSalt(): string {
  const salt = process.env.IP_HASH_SALT
  if (salt) return salt
  if (process.env.FUNCTIONS_EMULATOR === 'true') return EMULATOR_SALT
  return fail('failed-precondition', '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。')
}
```

`functions/src/responses/rateLimit.ts`:

```ts
import { fail } from '../shared/errors'

// 同じ接続元から同じアンケートへの回答は 10 分で 5 件まで（rateLimits/{slug}_{ipHash}.hits）

export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const RATE_LIMIT_MAX = 5

/** 10 分より古い受付を除き、5 件以上なら拒否する。受け付けるなら今回の時刻を加えた一覧を返す */
export function nextRateLimitHits(hits: Date[], now: Date): Date[] {
  const recent = hits.filter(hit => now.getTime() - hit.getTime() <= RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) fail('resource-exhausted', '短時間に多くの回答が送られました。しばらくしてから再度お試しください。')
  return [...recent, now]
}
```

`app/utils/evaluateRedirectRule.ts` の 3〜4 行目のコメントを、次の 2 行に置き換える（コードは変えない）:

```ts
// F-11 遷移条件の判定。モックの Functions だけが使う。本物の判定は functions/src/responses/evaluateRedirectRule.ts（同じ内容）。
// 回答画面には遷移条件を渡さないため、クライアントからはモックの Functions 経由でのみ呼ぶ。
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS（Task 1 と既存の単体テストもすべて PASS）

- [ ] **Step 5: 確認**

Run: `git status --short functions/src/responses app/utils/evaluateRedirectRule.ts`
Expected: `responses/` の 4 ファイルと `__tests__/` の 4 ファイルが未追跡、`app/utils/evaluateRedirectRule.ts` がコメントだけの変更として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 3: CSV の組み立て（純粋関数）

**Files:**
- Create: `functions/src/surveys/csv.ts`
- Test: `functions/src/surveys/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Question` / `Answers` / `AnswerValue`
- Produces:
  - `interface CsvVersion { version: number; questions: Question[] }`
  - `interface CsvResponse { createdAt: Date; surveyVersion: number; answers: Answers; isEligible: boolean; redirectedAt: Date | null }`
  - `escapeCsvCell(value: string): string`
  - `buildResponsesCsv(versions: CsvVersion[], responses: CsvResponse[]): string`（行の区切りは `\n`、BOM は付けない）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/surveys/__tests__/csv.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResponsesCsv, escapeCsvCell, type CsvVersion } from '../csv'

const V1: CsvVersion = {
  version: 1,
  questions: [
    { id: 'q-overall', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
    {
      id: 'q-good',
      type: 'multi',
      label: '良かった点',
      isRequired: false,
      options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
      useForReviewDraft: true,
    },
  ],
}
const V2: CsvVersion = {
  version: 2,
  questions: [
    { id: 'q-overall', type: 'rating', label: '総合満足度', isRequired: true, options: [], useForReviewDraft: true },
    { id: 'q-comment', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
  ],
}

test('buildResponsesCsv: バージョンをまたいで設問 ID で列をそろえる（設問文は新しい版のもの）。文面の列は出さない', () => {
  const csv = buildResponsesCsv([V2, V1], [
    {
      createdAt: new Date('2026-10-08T01:00:00.000Z'),
      surveyVersion: 2,
      answers: { 'q-overall': 5, 'q-comment': 'おいしい' },
      isEligible: true,
      redirectedAt: new Date('2026-10-08T01:01:00.000Z'),
    },
    {
      createdAt: new Date('2026-10-07T01:00:00.000Z'),
      surveyVersion: 1,
      answers: { 'q-overall': 2, 'q-good': ['o-taste', 'o-service'] },
      isEligible: false,
      redirectedAt: null,
    },
  ])
  assert.equal(csv, [
    '回答日時,バージョン,総合満足度,良かった点,ご感想,条件合致,Google 遷移日時',
    '2026-10-08T01:00:00.000Z,2,5,,おいしい,○,2026-10-08T01:01:00.000Z',
    '2026-10-07T01:00:00.000Z,1,2,味 / 接客,,,',
  ].join('\n'))
})

test('buildResponsesCsv: 回答が 0 件ならヘッダーだけ', () => {
  assert.equal(buildResponsesCsv([V1], []), '回答日時,バージョン,満足度,良かった点,条件合致,Google 遷移日時')
})

test('buildResponsesCsv: カンマ・改行・引用符を含む値は引用符で囲み、引用符は 2 つ重ねる', () => {
  const csv = buildResponsesCsv([V2], [
    { createdAt: new Date('2026-10-08T01:00:00.000Z'), surveyVersion: 2, answers: { 'q-comment': '味, 量\n"最高"' }, isEligible: false, redirectedAt: null },
  ])
  assert.equal(csv, '回答日時,バージョン,総合満足度,ご感想,条件合致,Google 遷移日時\n2026-10-08T01:00:00.000Z,2,,"味, 量\n""最高""",,')
})

test('escapeCsvCell: 改行コード（\\r）も引用符で囲む', () => {
  assert.equal(escapeCsvCell('a\r\nb'), '"a\r\nb"')
  assert.equal(escapeCsvCell('ふつう'), 'ふつう')
})

test('escapeCsvCell: = + - @ で始まる値は先頭に \' を付け、数式として実行させない（Review Focus 5）', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("http://example.com")'), `"'=HYPERLINK(""http://example.com"")"`)
  assert.equal(escapeCsvCell('+81 90'), "'+81 90")
  assert.equal(escapeCsvCell('-1'), "'-1")
  assert.equal(escapeCsvCell('@SUM(A1)'), "'@SUM(A1)")
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL。`Cannot find module '../csv'` でコンパイルが失敗する。

- [ ] **Step 3: 実装する**

`functions/src/surveys/csv.ts`:

```ts
import type { AnswerValue, Answers, Question } from './types'

// F-14 回答の CSV（モック app/utils/mock/functions/responses.ts の getResponsesCsvFunc の列の規則を移した）。
// バージョンをまたいでも列がそろうよう、全バージョンの設問を ID で集める。口コミ文面の列は出さない

export interface CsvVersion {
  version: number
  questions: Question[]
}

export interface CsvResponse {
  createdAt: Date
  surveyVersion: number
  answers: Answers
  isEligible: boolean
  redirectedAt: Date | null
}

/** Excel などで数式として解釈される先頭文字 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function escapeCsvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function formatAnswer(question: Question, answer: AnswerValue | undefined): string {
  if (answer === undefined) return ''
  if (question.type === 'single' || question.type === 'multi') {
    const ids = Array.isArray(answer) ? answer : [String(answer)]
    return ids.map(id => question.options.find(option => option.id === id)?.label ?? id).join(' / ')
  }
  return String(answer)
}

/** 回答を CSV にする。行の区切りは \n。BOM は画面側で付ける */
export function buildResponsesCsv(versions: CsvVersion[], responses: CsvResponse[]): string {
  // 古い版から順に入れ、同じ設問 ID は新しい版の設問文で上書きする（列の順は最初に出てきた順）
  const questions = new Map<string, Question>()
  for (const version of [...versions].sort((a, b) => a.version - b.version)) {
    for (const question of version.questions) questions.set(question.id, question)
  }
  const columns = [...questions.values()]
  const header = ['回答日時', 'バージョン', ...columns.map(question => question.label), '条件合致', 'Google 遷移日時']
  const rows = responses.map(response => [
    response.createdAt.toISOString(),
    String(response.surveyVersion),
    ...columns.map(question => formatAnswer(question, response.answers[question.id])),
    response.isEligible ? '○' : '',
    response.redirectedAt ? response.redirectedAt.toISOString() : '',
  ])
  return [header, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\n')
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS

- [ ] **Step 5: 確認**

Run: `git status --short functions/src/surveys`
Expected: Task 1 のファイルに加えて `csv.ts` と `__tests__/csv.test.ts` が未追跡として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 4: Firestore ルールとインデックス

**Files:**
- Modify: `firestore.rules`（冒頭のコメント、`match /users/{uid}` の後ろ、`match /usageMonthly/{month}` の後ろ）
- Modify: `firestore.indexes.json`
- Test: `functions/src/__tests__/firestore.rules.itest.ts`

**Interfaces:**
- Produces: 読み取りの規則。
  - `surveys` / `surveyVersions` / `responses` はメンバーが読める（staff は `storeId` が担当店舗のもののみ）。
  - `publicSurveys` は誰でも読める（`get` / `list`）。
  - `rateLimits` は全員拒否。書き込みはすべて不可。

- [ ] **Step 1: 失敗するテストを書く**

`firestore.rules.itest.ts` の import に `limit` と `orderBy` を加える:

```ts
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
```

`beforeEach` 内の次の行を:

```ts
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-1'), { title: 'x' })
```

次の内容に置き換える:

```ts
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-1'), { orgId: 'org-a', storeId: 'st-1', title: 'x' })
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-2'), { orgId: 'org-a', storeId: 'st-2', title: 'y' })
    await setDoc(doc(db, 'organizations/org-a/surveyVersions/sv-1_1'), { orgId: 'org-a', surveyId: 'sv-1', storeId: 'st-1', version: 1 })
    await setDoc(doc(db, 'organizations/org-a/surveyVersions/sv-2_1'), { orgId: 'org-a', surveyId: 'sv-2', storeId: 'st-2', version: 1 })
    await setDoc(doc(db, 'organizations/org-a/responses/res-1'), { orgId: 'org-a', surveyId: 'sv-1', storeId: 'st-1', createdAt: new Date('2026-10-01T00:00:00Z') })
    await setDoc(doc(db, 'organizations/org-a/responses/res-2'), { orgId: 'org-a', surveyId: 'sv-2', storeId: 'st-2', createdAt: new Date('2026-10-01T00:00:00Z') })
    await setDoc(doc(db, 'publicSurveys/slug-1'), { slug: 'slug-1', orgId: 'org-a', surveyId: 'sv-1', status: 'published' })
    await setDoc(doc(db, 'rateLimits/slug-1_abc'), { hits: [] })
```

テスト「秘密のコレクションと未対応のコレクションは誰も読めない」から、次の 1 行を削除する（アンケートは読めるようになるため）:

```ts
  await assertFails(getDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-1')))
```

ファイル末尾に追加する:

```ts
test('surveys / surveyVersions / responses: owner は全店舗、staff は担当店舗だけ。書き込みは不可', async () => {
  for (const path of ['organizations/org-a/surveys', 'organizations/org-a/surveyVersions', 'organizations/org-a/responses']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
    await assertFails(getDocs(collection(anonymous(), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/responses/res-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/responses/res-2')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/surveys/sv-2')))
  // useFirestoreSync の staff 向けの購読と同じ形
  await assertSucceeds(getDocs(query(
    collection(as('u-staff'), 'organizations/org-a/responses'),
    where('storeId', 'in', ['st-1']),
    where('createdAt', '>=', new Date('2026-07-01T00:00:00Z')),
    orderBy('createdAt', 'desc'),
    limit(2000),
  )))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-3'), { orgId: 'org-a', storeId: 'st-1' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-1'), { title: 'z' }))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/responses/res-3'), { orgId: 'org-a', storeId: 'st-1' }))
})

test('publicSurveys は未ログインでも読めて書けない。rateLimits は誰も読めない', async () => {
  await assertSucceeds(getDoc(doc(anonymous(), 'publicSurveys/slug-1')))
  await assertSucceeds(getDocs(collection(anonymous(), 'publicSurveys')))
  await assertFails(setDoc(doc(anonymous(), 'publicSurveys/slug-2'), { status: 'published' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'publicSurveys/slug-1'), { status: 'paused' }))
  await assertFails(getDoc(doc(anonymous(), 'rateLimits/slug-1_abc')))
  await assertFails(getDoc(doc(as('u-owner'), 'rateLimits/slug-1_abc')))
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL。新しい 2 テストの `assertSucceeds` が `PERMISSION_DENIED` で失敗する。

- [ ] **Step 3: ルールを追加する**

`firestore.rules` 冒頭のコメント `// docs/02-database.md 5 章のうち、基盤（組織・メンバー・招待・連携・店舗）・GBP・順位計測の読み取り規則。` を `// docs/02-database.md 5 章のうち、基盤（組織・メンバー・招待・連携・店舗）・GBP・順位計測・アンケートの読み取り規則。` に変える。

`match /users/{uid} { ... }` の直後（`match /databases/{database}/documents` の内側、`organizations` の外）に追加する:

```
    // 回答画面の公開データ（遷移ルール・生成設定・口コミ URL は含めない）。未ログインでも読める。
    // rateLimits/{slug}_{ipHash} はここに記載しない（全員拒否）
    match /publicSurveys/{slug} {
      allow read: if true;
    }
```

`match /usageMonthly/{month} { ... }` の直後（`match /organizations/{orgId}` の内側）に追加する:

```
      // アンケート（書き込みは Functions のみ）。staff は storeId in [担当店舗] で絞り込めば一覧も読める
      match /surveys/{surveyId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /surveyVersions/{versionId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /responses/{responseId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }
```

- [ ] **Step 4: インデックスを追加する**

`firestore.indexes.json` の `indexes` 配列の末尾（`rankSnapshots` の後ろ）に追加する:

```json
    {
      "collectionGroup": "responses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "storeId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "responses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "surveyId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "responses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "surveyId", "order": "ASCENDING" },
        { "fieldPath": "storeId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- 1 つ目は staff の購読（`storeId in` ＋ `createdAt` の降順）に使う。
- 2 つ目・3 つ目は CSV の検索（店舗の指定なし・あり）に使う。
- `surveys` と `surveyVersions` の `storeId in` は等価条件だけなので、自動インデックスで足りる（追加しない）。

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json', 'utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（既存のルールテスト・結合テストも PASS）

- [ ] **Step 6: 確認**

Run: `git diff --stat firestore.rules firestore.indexes.json functions/src/__tests__/firestore.rules.itest.ts`
Expected: 3 ファイルに、追加分と上記の置き換え・削除だけの差分が出る。コミットはユーザーの許可がある場合のみ行う。

---

### Task 5: 管理側の callable（作成・複製・下書き・公開・状態・slug・期間）

**Files:**
- Create: `functions/src/surveys/publicSurvey.ts`
- Create: `functions/src/surveys/surveys.ts`
- Test: `functions/src/surveys/__tests__/surveys.itest.ts`

**Interfaces:**
- Consumes:
  - Task 1：`SurveyContent` / `SurveyStatus` / `SurveyStatusAction` / `Question` / `SurveyDesign`、`SURVEY_TITLE_MAX` / `requireSurveyContent` / `validateSurveyForPublish`、`nextSurveyStatus` / `isPublicStatus`、`createSlug`、`StoredPeriod` / `requirePublishPeriod`
- Produces:
  - `surveys/publicSurvey.ts`
    - `interface SurveyDoc { orgId: string; storeId: string; title: string; status: SurveyStatus; publicSlug: string; draft: SurveyContent; currentVersion: number | null; hasUnpublishedChanges: boolean; publishPeriod: StoredPeriod }`
    - `interface PublicSurveyDoc { slug: string; orgId: string; surveyId: string; storeId: string; version: number; storeName: string; questions: Question[]; design: SurveyDesign; status: 'published' | 'paused'; publishPeriod: StoredPeriod }`
    - `surveysOf(db: Firestore, orgId: string): CollectionReference`
    - `versionRef(db: Firestore, orgId: string, surveyId: string, version: number): DocumentReference`
    - `publicSurveyRef(db: Firestore, slug: string): DocumentReference`
    - `loadSurvey(db: Firestore, caller: Caller, orgId: string, surveyId: string, tx?: Transaction): Promise<{ ref: DocumentReference; survey: SurveyDoc; member: MemberDoc }>`
    - `readPublicSource(tx: Transaction, db: Firestore, orgId: string, surveyId: string, survey: SurveyDoc): Promise<{ content: SurveyContent | null; storeName: string }>`
    - `writePublicSurvey(tx: Transaction, db: Firestore, surveyId: string, survey: SurveyDoc, content: SurveyContent | null, storeName: string): void`
  - `surveys/surveys.ts`（すべて `(db: Firestore, caller: Caller, data: unknown)`）
    - `createSurveyFunc` → `Promise<{ id: string }>`。data: `{ orgId, storeId, title, content: SurveyContent }`
    - `createSurveyCopyFunc` → `Promise<{ id: string }>`。data: `{ orgId, surveyId, storeId }`
    - `updateSurveyDraftFunc` → `Promise<void>`。data: `{ orgId, surveyId, title, draft: SurveyContent }`
    - `updateSurveyPublishFunc` → `Promise<{ version: number }>`。data: `{ orgId, surveyId }`
    - `updateSurveyStatusFunc` → `Promise<{ status: SurveyStatus }>`。data: `{ orgId, surveyId, action: 'pause' | 'resume' | 'close' }`
    - `updateSurveySlugFunc` → `Promise<{ slug: string }>`。data: `{ orgId, surveyId }`
    - `updateSurveyPeriodFunc` → `Promise<void>`。data: `{ orgId, surveyId, publishPeriod: { startAt: string | null; endAt: string | null } }`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/surveys/__tests__/surveys.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import {
  createSurveyCopyFunc,
  createSurveyFunc,
  updateSurveyDraftFunc,
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
} from '../surveys'
import { sampleContent } from './sampleContent'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, ORG, 'st-1', '渋谷店')
  await seedStore(db, ORG, 'st-2', '新宿店')
  for (const storeId of ['st-1', 'st-2']) {
    await db.doc(`organizations/${ORG}/stores/${storeId}`).update({ reviewUrl: `https://search.google.com/local/writereview?placeid=p-${storeId}` })
  }
})

const create = (storeId = 'st-1', who = OWNER, title = '来店アンケート') =>
  createSurveyFunc(db, who, { orgId: ORG, storeId, title, content: sampleContent() })
const surveyOf = async (id: string) => (await db.doc(`organizations/${ORG}/surveys/${id}`).get()).data()!
const publicOf = (slug: string) => db.doc(`publicSurveys/${slug}`).get()
const target = (surveyId: string) => ({ orgId: ORG, surveyId })

test('createSurvey: 下書きで作成し、slug を発行する（公開データはまだ作らない）', async () => {
  const { id } = await create()
  const survey = await surveyOf(id)
  assert.equal(survey.orgId, ORG)
  assert.equal(survey.storeId, 'st-1')
  assert.equal(survey.title, '来店アンケート')
  assert.equal(survey.status, 'draft')
  assert.match(survey.publicSlug, /^[a-km-np-z2-9]{10}$/)
  assert.deepEqual(survey.draft, sampleContent())
  assert.equal(survey.currentVersion, null)
  assert.equal(survey.hasUnpublishedChanges, false)
  assert.deepEqual(survey.publishPeriod, { startAt: null, endAt: null })
  assert.ok(survey.createdAt)
  assert.equal((await publicOf(survey.publicSlug)).exists, false)
})

test('createSurvey: staff は担当店舗だけ。存在しない・アーカイブ済みの店舗、誤った入力、非メンバーは拒否', async () => {
  await create('st-1', STAFF)
  await assert.rejects(create('st-2', STAFF), { code: 'permission-denied' })
  await assert.rejects(create('st-9'), { code: 'not-found' })
  await db.doc(`organizations/${ORG}/stores/st-2`).update({ status: 'archived' })
  await assert.rejects(create('st-2'), { code: 'not-found' })
  await assert.rejects(createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: ' ', content: sampleContent() }), { code: 'invalid-argument' })
  await assert.rejects(create('st-1', OWNER, 'あ'.repeat(61)), { code: 'invalid-argument' })
  await assert.rejects(createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: 'x', content: { questions: 'x' } }), { code: 'invalid-argument' })
  await assert.rejects(create('st-1', caller('u-other')), { code: 'permission-denied' })
})

test('createSurvey / createSurveyCopy: 終了以外の件数で上限を判定する（終了すると作れる）', async () => {
  await db.doc(`organizations/${ORG}`).update({ 'limits.maxSurveys': 2 })
  const first = await create()
  await create()
  await assert.rejects(create(), { code: 'resource-exhausted', message: 'アンケート数の上限（2 件）に達しています。' })
  await assert.rejects(createSurveyCopyFunc(db, OWNER, { ...target(first.id), storeId: 'st-1' }), { code: 'resource-exhausted' })

  await updateSurveyPublishFunc(db, OWNER, target(first.id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(first.id), action: 'close' })
  await create()
})

test('createSurveyCopy: 下書きを別の店舗に複製する。60 文字のタイトルも 60 文字に収める', async () => {
  const { id } = await create()
  const edited = { ...sampleContent(), design: { intro: '変更後の案内', thanksMessage: 'ありがとう' } }
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: edited })

  const copied = await surveyOf((await createSurveyCopyFunc(db, OWNER, { ...target(id), storeId: 'st-2' })).id)
  const source = await surveyOf(id)
  assert.equal(copied.storeId, 'st-2')
  assert.equal(copied.title, '来店アンケート（コピー）')
  assert.equal(copied.status, 'draft')
  assert.equal(copied.currentVersion, null)
  assert.deepEqual(copied.draft, edited)
  assert.notEqual(copied.publicSlug, source.publicSlug)

  const long = await create('st-1', OWNER, 'あ'.repeat(60))
  const longCopy = await surveyOf((await createSurveyCopyFunc(db, OWNER, { ...target(long.id), storeId: 'st-1' })).id)
  assert.equal(longCopy.title, `${'あ'.repeat(55)}（コピー）`)
  assert.equal(longCopy.title.length, 60)
})

test('createSurveyCopy: staff は担当外の店舗へも、担当外の店舗からも複製できない', async () => {
  const mine = await create('st-1', STAFF)
  await assert.rejects(createSurveyCopyFunc(db, STAFF, { ...target(mine.id), storeId: 'st-2' }), { code: 'permission-denied' })
  const other = await create('st-2')
  await assert.rejects(createSurveyCopyFunc(db, STAFF, { ...target(other.id), storeId: 'st-1' }), { code: 'permission-denied' })
  await assert.rejects(createSurveyCopyFunc(db, OWNER, { ...target('none'), storeId: 'st-1' }), { code: 'not-found' })
})

test('updateSurveyDraft: 下書きを保存する。公開版があれば未公開の変更ありにする。終了後は不可', async () => {
  const { id } = await create()
  const editing = sampleContent()
  editing.questions[0]!.label = ''
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: ' 新しいタイトル ', draft: editing })
  const saved = await surveyOf(id)
  assert.equal(saved.title, '新しいタイトル')
  assert.deepEqual(saved.draft, editing)
  assert.equal(saved.hasUnpublishedChanges, false)

  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '新しいタイトル', draft: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  assert.equal((await surveyOf(id)).hasUnpublishedChanges, false)
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '新しいタイトル', draft: editing })
  assert.equal((await surveyOf(id)).hasUnpublishedChanges, true)

  const tooLong = { ...sampleContent(), questions: [{ ...sampleContent().questions[0]!, label: 'あ'.repeat(101) }] }
  await assert.rejects(updateSurveyDraftFunc(db, OWNER, { ...target(id), title: 'x', draft: tooLong }), { code: 'invalid-argument' })
  await assert.rejects(updateSurveyDraftFunc(db, OWNER, { ...target('none'), title: 'x', draft: sampleContent() }), { code: 'not-found' })

  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(
    updateSurveyDraftFunc(db, OWNER, { ...target(id), title: 'x', draft: sampleContent() }),
    { code: 'failed-precondition', message: '終了したアンケートは編集できません。' },
  )
})

test('updateSurveyPublish: 版を作り、公開データを作り直す（遷移ルール・生成設定・口コミ URL は含めない）', async () => {
  const { id } = await create()
  assert.deepEqual(await updateSurveyPublishFunc(db, OWNER, target(id)), { version: 1 })

  const survey = await surveyOf(id)
  assert.equal(survey.status, 'published')
  assert.equal(survey.currentVersion, 1)
  assert.equal(survey.hasUnpublishedChanges, false)
  const version = (await db.doc(`organizations/${ORG}/surveyVersions/${id}_1`).get()).data()!
  assert.equal(version.orgId, ORG)
  assert.equal(version.surveyId, id)
  assert.equal(version.storeId, 'st-1')
  assert.equal(version.version, 1)
  assert.deepEqual(version.content, sampleContent())
  assert.equal(version.publishedBy, 'u-owner')
  const published = (await publicOf(survey.publicSlug)).data()!
  assert.deepEqual(Object.keys(published).sort(), ['design', 'orgId', 'publishPeriod', 'questions', 'slug', 'status', 'storeId', 'storeName', 'surveyId', 'version'])
  assert.equal(published.slug, survey.publicSlug)
  assert.equal(published.storeName, '渋谷店')
  assert.equal(published.status, 'published')
  assert.equal(published.version, 1)
  assert.deepEqual(published.questions, sampleContent().questions)
  assert.deepEqual(published.design, sampleContent().design)

  // 変更を公開すると版が増え、前の版は変わらない
  const next = sampleContent()
  next.questions.push({ id: 'q-new', type: 'text', label: '追加の設問', isRequired: false, options: [], useForReviewDraft: false })
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: next })
  assert.deepEqual(await updateSurveyPublishFunc(db, OWNER, target(id)), { version: 2 })
  assert.equal((await db.doc(`organizations/${ORG}/surveyVersions/${id}_1`).get()).get('content.questions').length, 3)
  const republished = await publicOf(survey.publicSlug)
  assert.equal(republished.get('version'), 2)
  assert.equal(republished.get('questions').length, 4)
})

test('updateSurveyPublish: 停止中に変更を公開すると公開中に戻る（モックと同じ）', async () => {
  const { id } = await create()
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const survey = await surveyOf(id)
  assert.equal(survey.status, 'published')
  assert.equal((await publicOf(survey.publicSlug)).get('status'), 'published')
})

test('updateSurveyPublish: 公開前の検証に失敗したら公開しない。終了後は不可', async () => {
  const { id } = await create()
  const noRule = { ...sampleContent(), redirectRule: { operator: 'and', conditions: [] } }
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: noRule })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '遷移条件を 1 つ以上設定してください。' })
  assert.equal((await surveyOf(id)).status, 'draft')
  assert.equal((await db.collection(`organizations/${ORG}/surveyVersions`).get()).size, 0)

  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: sampleContent() })
  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: '' })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '店舗の口コミ URL が設定されていません。' })

  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: 'https://search.google.com/local/writereview?placeid=p-st-1' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '終了したアンケートは公開できません。' })
})

test('updateSurveyStatus: 停止で paused、再開で published、終了で公開データを削除する', async () => {
  const { id } = await create()
  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' }), { code: 'failed-precondition', message: 'この状態からは変更できません。' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const { publicSlug } = await surveyOf(id)

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' }), { status: 'paused' })
  assert.equal((await surveyOf(id)).status, 'paused')
  assert.equal((await publicOf(publicSlug)).get('status'), 'paused')

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'resume' }), { status: 'published' })
  assert.equal((await publicOf(publicSlug)).get('status'), 'published')

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' }), { status: 'closed' })
  assert.equal((await surveyOf(id)).status, 'closed')
  assert.equal((await publicOf(publicSlug)).exists, false)

  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'resume' }), { code: 'failed-precondition' })
  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'stop' }), { code: 'invalid-argument' })
})

test('updateSurveySlug: 古い公開データを消し、公開中・停止中なら新しい slug で作り直す。終了後は不可', async () => {
  const { id } = await create()
  const first = (await surveyOf(id)).publicSlug
  const { slug: second } = await updateSurveySlugFunc(db, OWNER, target(id))
  assert.notEqual(second, first)
  assert.equal((await surveyOf(id)).publicSlug, second)
  assert.equal((await publicOf(second)).exists, false)

  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' })
  const { slug: third } = await updateSurveySlugFunc(db, OWNER, target(id))
  assert.equal((await publicOf(second)).exists, false)
  const reissued = await publicOf(third)
  assert.equal(reissued.get('slug'), third)
  assert.equal(reissued.get('status'), 'paused')

  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(updateSurveySlugFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '終了したアンケートの URL は再発行できません。' })
})

test('updateSurveyPeriod: 期間を保存し、公開データにも反映する。終了は開始より後', async () => {
  const { id } = await create()
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const period = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-31T15:00:00.000Z' }
  await updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: period })

  const survey = await surveyOf(id)
  assert.equal(survey.publishPeriod.startAt.toDate().toISOString(), period.startAt)
  assert.equal(survey.publishPeriod.endAt.toDate().toISOString(), period.endAt)
  assert.equal((await publicOf(survey.publicSlug)).get('publishPeriod.endAt').toDate().toISOString(), period.endAt)

  await updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: { startAt: null, endAt: null } })
  assert.equal((await publicOf(survey.publicSlug)).get('publishPeriod.startAt'), null)

  await assert.rejects(
    updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: { startAt: period.endAt, endAt: period.startAt } }),
    { code: 'invalid-argument', message: '終了日時は開始日時より後にしてください。' },
  )
})

test('担当外の店舗のアンケートは、staff は保存・公開・状態・slug・期間を操作できない', async () => {
  const { id } = await create('st-2')
  const denied = { code: 'permission-denied' }
  await assert.rejects(updateSurveyDraftFunc(db, STAFF, { ...target(id), title: 'x', draft: sampleContent() }), denied)
  await assert.rejects(updateSurveyPublishFunc(db, STAFF, target(id)), denied)
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await assert.rejects(updateSurveyStatusFunc(db, STAFF, { ...target(id), action: 'pause' }), denied)
  await assert.rejects(updateSurveySlugFunc(db, STAFF, target(id)), denied)
  await assert.rejects(updateSurveyPeriodFunc(db, STAFF, { ...target(id), publishPeriod: { startAt: null, endAt: null } }), denied)
  await assert.rejects(updateSurveyPublishFunc(db, caller('u-other'), target(id)), denied)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../surveys'`）

- [ ] **Step 3: 公開データの組み立てを実装する**

`functions/src/surveys/publicSurvey.ts`:

```ts
import type { CollectionReference, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg, requireStoreAccess, type MemberDoc } from '../shared/members'
import type { StoredPeriod } from './period'
import { isPublicStatus } from './status'
import type { Question, SurveyContent, SurveyDesign, SurveyStatus } from './types'

// アンケートの Firestore 上の形と、回答画面の公開データ（publicSurveys/{slug}）の作り直し

/** organizations/{orgId}/surveys/{surveyId} */
export interface SurveyDoc {
  orgId: string
  storeId: string
  title: string
  status: SurveyStatus
  publicSlug: string
  draft: SurveyContent
  currentVersion: number | null
  hasUnpublishedChanges: boolean
  publishPeriod: StoredPeriod
}

/** publicSurveys/{slug}。未ログインでも読めるため、遷移ルール・生成設定・口コミ URL は含めない */
export interface PublicSurveyDoc {
  slug: string
  orgId: string
  surveyId: string
  storeId: string
  version: number
  storeName: string
  questions: Question[]
  design: SurveyDesign
  status: 'published' | 'paused'
  publishPeriod: StoredPeriod
}

export function surveysOf(db: Firestore, orgId: string): CollectionReference {
  return db.collection(`organizations/${orgId}/surveys`)
}

/** 公開版。staff の購読（storeId in）のため、組織直下に {surveyId}_{n} で置く */
export function versionRef(db: Firestore, orgId: string, surveyId: string, version: number): DocumentReference {
  return db.doc(`organizations/${orgId}/surveyVersions/${surveyId}_${version}`)
}

export function publicSurveyRef(db: Firestore, slug: string): DocumentReference {
  return db.doc(`publicSurveys/${slug}`)
}

/** アンケートを読み、権限を確かめる（組織のメンバー。staff は担当店舗のみ）。tx を渡すとトランザクション内で読む */
export async function loadSurvey(
  db: Firestore,
  caller: Caller,
  orgId: string,
  surveyId: string,
  tx?: Transaction,
): Promise<{ ref: DocumentReference; survey: SurveyDoc; member: MemberDoc }> {
  await requireOrg(db, orgId, tx)
  const member = await requireMember(db, orgId, caller.uid, undefined, tx)
  const ref = surveysOf(db, orgId).doc(surveyId)
  const snapshot = tx ? await tx.get(ref) : await ref.get()
  if (!snapshot.exists) fail('not-found', 'アンケートが見つかりません。')
  const survey = snapshot.data() as SurveyDoc
  requireStoreAccess(member, survey.storeId)
  return { ref, survey, member }
}

/** 公開データの作り直しに使う、公開版の中身と店舗名を読む（トランザクションの書き込みより前に呼ぶ） */
export async function readPublicSource(
  tx: Transaction,
  db: Firestore,
  orgId: string,
  surveyId: string,
  survey: SurveyDoc,
): Promise<{ content: SurveyContent | null; storeName: string }> {
  const store = await tx.get(db.doc(`organizations/${orgId}/stores/${survey.storeId}`))
  const storeName = (store.get('name') as string | undefined) ?? ''
  if (survey.currentVersion === null) return { content: null, storeName }
  const version = await tx.get(versionRef(db, orgId, surveyId, survey.currentVersion))
  return { content: version.exists ? (version.get('content') as SurveyContent) : null, storeName }
}

/** 公開データを survey の状態に合わせて作り直す。公開中・停止中でなければ削除する */
export function writePublicSurvey(
  tx: Transaction,
  db: Firestore,
  surveyId: string,
  survey: SurveyDoc,
  content: SurveyContent | null,
  storeName: string,
): void {
  const ref = publicSurveyRef(db, survey.publicSlug)
  if (!content || survey.currentVersion === null || !isPublicStatus(survey.status)) {
    tx.delete(ref)
    return
  }
  const data: PublicSurveyDoc = {
    slug: survey.publicSlug,
    orgId: survey.orgId,
    surveyId,
    storeId: survey.storeId,
    version: survey.currentVersion,
    storeName,
    questions: content.questions,
    design: content.design,
    status: survey.status,
    publishPeriod: survey.publishPeriod,
  }
  tx.set(ref, data)
}
```

- [ ] **Step 4: callable を実装する**

`functions/src/surveys/surveys.ts`:

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg, requireStoreAccess } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { SURVEY_TITLE_MAX, requireSurveyContent, validateSurveyForPublish } from './content'
import { requirePublishPeriod } from './period'
import { loadSurvey, publicSurveyRef, readPublicSource, surveysOf, versionRef, writePublicSurvey, type SurveyDoc } from './publicSurvey'
import { createSlug } from './slug'
import { nextSurveyStatus } from './status'
import type { SurveyContent, SurveyStatus, SurveyStatusAction } from './types'

// surveys/ … アンケートの作成・複製・下書き・公開管理（docs/04-features.md F-06〜F-09）。
// 権限はモックと同じ「組織のメンバー。staff は担当店舗のみ」

/** 上限の件数に数える状態（終了は数えない） */
const OPEN_STATUSES: SurveyStatus[] = ['draft', 'published', 'paused']
const STATUS_ACTIONS: readonly SurveyStatusAction[] = ['pause', 'resume', 'close']
const COPY_SUFFIX = '（コピー）'

function requireTarget(data: unknown) {
  const input = asObject(data)
  return { input, orgId: requireId(input.orgId, '組織 ID'), surveyId: requireId(input.surveyId, 'アンケート ID') }
}

function touched() {
  return { updatedAt: FieldValue.serverTimestamp() }
}

/** 店舗と件数の上限を確かめて、下書きのアンケートを作る（作成と複製で共通） */
async function createSurveyDoc(
  db: Firestore,
  caller: Caller,
  orgId: string,
  storeId: string,
  title: string,
  content: SurveyContent,
): Promise<{ id: string }> {
  const ref = surveysOf(db, orgId).doc()
  await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    const member = await requireMember(db, orgId, caller.uid, undefined, tx)
    requireStoreAccess(member, storeId)
    const store = await tx.get(db.doc(`organizations/${orgId}/stores/${storeId}`))
    if (!store.exists || store.get('status') !== 'active') fail('not-found', '店舗が見つかりません。')
    const count = (await tx.get(surveysOf(db, orgId).where('status', 'in', OPEN_STATUSES).count())).data().count
    if (count >= org.limits.maxSurveys) fail('resource-exhausted', `アンケート数の上限（${org.limits.maxSurveys} 件）に達しています。`)
    tx.create(ref, {
      orgId,
      storeId,
      title,
      status: 'draft',
      publicSlug: createSlug(),
      draft: content,
      currentVersion: null,
      hasUnpublishedChanges: false,
      publishPeriod: { startAt: null, endAt: null },
      createdAt: FieldValue.serverTimestamp(),
      ...touched(),
    })
  })
  return { id: ref.id }
}

export async function createSurveyFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  const title = requireString(input.title, 'タイトル', SURVEY_TITLE_MAX)
  const content = requireSurveyContent(input.content)
  return createSurveyDoc(db, caller, orgId, storeId, title, content)
}

/** 複製のタイトル。60 文字に収まるよう元のタイトルの末尾を切る */
function copyTitle(title: string): string {
  return `${title.slice(0, SURVEY_TITLE_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`
}

/** 元のアンケートの下書きを複製する（別の店舗も指定できる。終了したアンケートも複製できる） */
export async function createSurveyCopyFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const { input, orgId, surveyId } = requireTarget(data)
  const storeId = requireId(input.storeId, '店舗 ID')
  const { survey } = await loadSurvey(db, caller, orgId, surveyId)
  return createSurveyDoc(db, caller, orgId, storeId, copyTitle(survey.title), survey.draft)
}

/** 下書きを保存する（画面の自動保存）。形と文字数だけを検証し、中身の検証は公開時に行う */
export async function updateSurveyDraftFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const { input, orgId, surveyId } = requireTarget(data)
  const title = requireString(input.title, 'タイトル', SURVEY_TITLE_MAX)
  const draft = requireSurveyContent(input.draft)
  await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートは編集できません。')
    tx.update(ref, { title, draft, hasUnpublishedChanges: survey.currentVersion !== null, ...touched() })
  })
}

/** 下書きを新しい版として公開する。版の作成・アンケートの更新・公開データの作り直しを 1 つのトランザクションで行う */
export async function updateSurveyPublishFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ version: number }> {
  const { orgId, surveyId } = requireTarget(data)
  const version = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートは公開できません。')
    const store = await tx.get(db.doc(`organizations/${orgId}/stores/${survey.storeId}`))
    const errors = validateSurveyForPublish(
      survey.draft,
      store.exists ? { status: store.get('status'), reviewUrl: store.get('reviewUrl') ?? null } : null,
    )
    if (errors.length > 0) fail('failed-precondition', errors.join('\n'))

    const next = (survey.currentVersion ?? 0) + 1
    tx.create(versionRef(db, orgId, surveyId, next), {
      orgId,
      surveyId,
      storeId: survey.storeId,
      version: next,
      content: survey.draft,
      publishedBy: caller.uid,
      publishedAt: FieldValue.serverTimestamp(),
    })
    tx.update(ref, { status: 'published', currentVersion: next, hasUnpublishedChanges: false, ...touched() })
    const published: SurveyDoc = { ...survey, status: 'published', currentVersion: next, hasUnpublishedChanges: false }
    writePublicSurvey(tx, db, surveyId, published, survey.draft, (store.get('name') as string | undefined) ?? '')
    return next
  })
  return { version }
}

/** 一時停止・再開・終了。公開データは停止で paused、再開で published、終了で削除 */
export async function updateSurveyStatusFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ status: SurveyStatus }> {
  const { input, orgId, surveyId } = requireTarget(data)
  const action = requireOneOf(input.action, STATUS_ACTIONS, '操作')
  const status = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    const next = nextSurveyStatus(survey.status, action)
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    tx.update(ref, { status: next, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, status: next }, source.content, source.storeName)
    return next
  })
  return { status }
}

/** URL を再発行する。旧 URL（配布済みの QR）は使えなくなる */
export async function updateSurveySlugFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ slug: string }> {
  const { orgId, surveyId } = requireTarget(data)
  const slug = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートの URL は再発行できません。')
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    const nextSlug = createSlug()
    tx.delete(publicSurveyRef(db, survey.publicSlug))
    tx.update(ref, { publicSlug: nextSlug, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, publicSlug: nextSlug }, source.content, source.storeName)
    return nextSlug
  })
  return { slug }
}

/** 公開期間を変える。公開データがあれば反映する */
export async function updateSurveyPeriodFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const { input, orgId, surveyId } = requireTarget(data)
  const publishPeriod = requirePublishPeriod(input.publishPeriod)
  await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    tx.update(ref, { publishPeriod, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, publishPeriod }, source.content, source.storeName)
  })
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（既存の結合テスト・ルールテストも PASS）

Run: `npm --prefix functions test`
Expected: PASS

- [ ] **Step 6: 確認**

Run: `git status --short functions/src/surveys`
Expected: `publicSurvey.ts`、`surveys.ts`、`__tests__/surveys.itest.ts` が増えている。コミットはユーザーの許可がある場合のみ行う。

---

### Task 6: 回答の CSV（callable）

**Files:**
- Create: `functions/src/surveys/responsesCsv.ts`
- Test: `functions/src/surveys/__tests__/responsesCsv.itest.ts`

**Interfaces:**
- Consumes:
  - Task 1：`parseOptionalDate`
  - Task 3：`buildResponsesCsv` / `CsvVersion` / `CsvResponse`
  - Task 5：`loadSurvey`、`createSurveyFunc` / `updateSurveyPublishFunc`（テストの準備）
- Produces:
  - `CSV_LIMIT = 5000`
  - `getResponsesCsvFunc(db: Firestore, caller: Caller, data: unknown) => Promise<{ csv: string }>`
    - data: `{ orgId, surveyId, storeId?: string | null, from?: string | null, to?: string | null }`（日時は ISO 文字列）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/surveys/__tests__/responsesCsv.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { commitWrites, type WriteOp } from '../../shared/firestoreWrites'
import { getResponsesCsvFunc } from '../responsesCsv'
import { createSurveyFunc, updateSurveyPublishFunc } from '../surveys'
import { sampleContent } from './sampleContent'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  for (const [storeId, name] of [['st-1', '渋谷店'], ['st-2', '新宿店']]) {
    await seedStore(db, ORG, storeId!, name!)
    await db.doc(`organizations/${ORG}/stores/${storeId}`).update({ reviewUrl: `https://search.google.com/local/writereview?placeid=p-${storeId}` })
  }
})

async function createPublished(storeId: string): Promise<string> {
  const { id } = await createSurveyFunc(db, OWNER, { orgId: ORG, storeId, title: '来店アンケート', content: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, { orgId: ORG, surveyId: id })
  return id
}

function responseData(surveyId: string, storeId: string, createdAt: string, answers: Record<string, unknown>, isEligible = false) {
  return { orgId: ORG, surveyId, storeId, surveyVersion: 1, answers, isEligible, reviewDraft: null, redirectedAt: null, createdAt: new Date(createdAt), ipHash: 'x' }
}

test('getResponsesCsv: アンケートの回答を新しい順に CSV にする。期間で絞り込める', async () => {
  const surveyId = await createPublished('st-1')
  const other = await createPublished('st-1')
  await db.doc(`organizations/${ORG}/responses/r-1`).set(responseData(surveyId, 'st-1', '2026-10-01T00:00:00.000Z', { 'q-overall': 4 }, true))
  await db.doc(`organizations/${ORG}/responses/r-2`).set(responseData(surveyId, 'st-1', '2026-10-05T00:00:00.000Z', { 'q-overall': 2, 'q-comment': 'ふつう' }))
  await db.doc(`organizations/${ORG}/responses/r-3`).set(responseData(other, 'st-1', '2026-10-06T00:00:00.000Z', { 'q-overall': 5 }))

  const { csv } = await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId })
  assert.equal(csv, [
    '回答日時,バージョン,満足度,良かった点,ご感想,条件合致,Google 遷移日時',
    '2026-10-05T00:00:00.000Z,1,2,,ふつう,,',
    '2026-10-01T00:00:00.000Z,1,4,,,○,',
  ].join('\n'))

  const recent = (await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: '2026-10-03T00:00:00.000Z' })).csv.split('\n')
  assert.equal(recent.length, 2)
  assert.match(recent[1]!, /^2026-10-05/)
  const older = (await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, to: '2026-10-03T00:00:00.000Z' })).csv.split('\n')
  assert.equal(older.length, 2)
  assert.match(older[1]!, /^2026-10-01/)
  await assert.rejects(getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: 'きのう' }), { code: 'invalid-argument' })
})

test('getResponsesCsv: staff は担当外の店舗のアンケートを出せない。storeId の指定も担当店舗だけ', async () => {
  const mine = await createPublished('st-1')
  const other = await createPublished('st-2')
  await getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: mine, storeId: 'st-1' })
  await assert.rejects(getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: other }), { code: 'permission-denied' })
  await assert.rejects(getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: mine, storeId: 'st-2' }), { code: 'permission-denied' })
  await assert.rejects(getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId: 'none' }), { code: 'not-found' })
})

test('getResponsesCsv: 5,000 件を超えたら resource-exhausted（期間を絞れば出せる）', async () => {
  const surveyId = await createPublished('st-1')
  const writes: WriteOp[] = Array.from({ length: 5001 }, (_, index) => (batch) => {
    const createdAt = index === 0 ? '2026-09-01T00:00:00.000Z' : '2026-10-01T00:00:00.000Z'
    batch.set(db.doc(`organizations/${ORG}/responses/r-${index}`), responseData(surveyId, 'st-1', createdAt, { 'q-overall': 5 }, true))
  })
  await commitWrites(db, writes)

  await assert.rejects(
    getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId }),
    { code: 'resource-exhausted', message: 'CSV は 5000 件までです。期間を絞ってください。' },
  )
  const { csv } = await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: '2026-09-15T00:00:00.000Z' })
  assert.equal(csv.split('\n').length, 5001)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../responsesCsv'`）

- [ ] **Step 3: 実装する**

`functions/src/surveys/responsesCsv.ts`:

```ts
import type { DocumentData, Firestore, Query, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireStoreAccess } from '../shared/members'
import { asObject, requireId } from '../shared/validation'
import { buildResponsesCsv, type CsvResponse, type CsvVersion } from './csv'
import { parseOptionalDate } from './period'
import { loadSurvey } from './publicSurvey'

// F-14 回答の CSV。画面の購読（直近 90 日・2,000 件）とは別に、サーバー側で回答を検索し直す

export const CSV_LIMIT = 5000

function toCsvResponse(data: DocumentData): CsvResponse {
  return {
    createdAt: (data.createdAt as Timestamp).toDate(),
    surveyVersion: data.surveyVersion,
    answers: data.answers ?? {},
    isEligible: data.isEligible === true,
    redirectedAt: data.redirectedAt ? (data.redirectedAt as Timestamp).toDate() : null,
  }
}

export async function getResponsesCsvFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ csv: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const surveyId = requireId(input.surveyId, 'アンケート ID')
  const storeId = input.storeId == null ? null : requireId(input.storeId, '店舗 ID')
  const from = parseOptionalDate(input.from, '期間')
  const to = parseOptionalDate(input.to, '期間')
  const { member } = await loadSurvey(db, caller, orgId, surveyId)
  if (storeId) requireStoreAccess(member, storeId)

  // インデックス: responses (surveyId, createdAt DESC) / (surveyId, storeId, createdAt DESC)
  let responses: Query = db.collection(`organizations/${orgId}/responses`).where('surveyId', '==', surveyId)
  if (storeId) responses = responses.where('storeId', '==', storeId)
  if (from) responses = responses.where('createdAt', '>=', from)
  if (to) responses = responses.where('createdAt', '<=', to)
  const [found, versions] = await Promise.all([
    responses.orderBy('createdAt', 'desc').limit(CSV_LIMIT + 1).get(),
    db.collection(`organizations/${orgId}/surveyVersions`).where('surveyId', '==', surveyId).get(),
  ])
  if (found.size > CSV_LIMIT) fail('resource-exhausted', `CSV は ${CSV_LIMIT} 件までです。期間を絞ってください。`)

  const csvVersions: CsvVersion[] = versions.docs.map(doc => ({ version: doc.get('version'), questions: doc.get('content.questions') ?? [] }))
  return { csv: buildResponsesCsv(csvVersions, found.docs.map(doc => toCsvResponse(doc.data()))) }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（5,001 件を書くテストは数秒かかる）

- [ ] **Step 5: 確認**

Run: `git status --short functions/src/surveys`
Expected: `responsesCsv.ts` と `__tests__/responsesCsv.itest.ts` が増えている。コミットはユーザーの許可がある場合のみ行う。

---

### Task 7: 回答側の callable（postSurveyResponse・postReviewRedirect）と接続元の IP

**Files:**
- Modify（全体を置き換え）: `functions/src/shared/callable.ts`
- Create: `functions/src/responses/usage.ts`
- Create: `functions/src/responses/responses.ts`
- Test: `functions/src/shared/__tests__/callable.test.ts`、`functions/src/responses/__tests__/responses.itest.ts`

**Interfaces:**
- Consumes:
  - Task 1：`SurveyContent`、`isWithinPeriod` / `toPeriod`
  - Task 2：`requireAnswers` / `evaluateRedirectRule` / `hashIp` / `getIpHashSalt` / `nextRateLimitHits`
  - Task 5：`publicSurveyRef` / `versionRef` / `PublicSurveyDoc`、`createSurveyFunc` / `updateSurveyPublishFunc` / `updateSurveyStatusFunc` / `updateSurveyPeriodFunc`（テストの準備）
  - 既存：`toJstMonthKey`（`rankings/validation.ts`）
- Produces:
  - `interface PublicContext { ip: string | null }`
  - `clientIpOf(rawRequest: { ip?: string } | undefined): string | null`
  - `publicCallable<T>(handler: (db: Firestore, data: unknown, context: PublicContext) => Promise<T>)`（既存の `getInvitationFunc(db, data)` はそのまま渡せる）
  - `addResponseUsage(tx: Transaction, db: Firestore, orgId: string, now: Date): void`
  - `interface ResponseDeps { now(): Date; ipHashSalt(): string }`、`defaultResponseDeps: ResponseDeps`
  - `interface PostSurveyResponseResult { responseId: string; isEligible: boolean; reviewUrl: string | null }`
  - `postSurveyResponseFunc(db: Firestore, data: unknown, context: PublicContext, deps?: ResponseDeps) => Promise<PostSurveyResponseResult>`
    - data: `{ slug, submissionId, answers }`
  - `postReviewRedirectFunc(db: Firestore, data: unknown, deps?: ResponseDeps) => Promise<void>`
    - data: `{ slug, submissionId }`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/shared/__tests__/callable.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIpOf } from '../callable'

test('clientIpOf: rawRequest.ip を返し、とれなければ null', () => {
  assert.equal(clientIpOf({ ip: '203.0.113.1' }), '203.0.113.1')
  assert.equal(clientIpOf({ ip: '' }), null)
  assert.equal(clientIpOf({}), null)
  assert.equal(clientIpOf(undefined), null)
})
```

`functions/src/responses/__tests__/responses.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { sampleContent } from '../../surveys/__tests__/sampleContent'
import { createSurveyFunc, updateSurveyPeriodFunc, updateSurveyPublishFunc, updateSurveyStatusFunc } from '../../surveys/surveys'
import { hashIp } from '../ipHash'
import { postReviewRedirectFunc, postSurveyResponseFunc, type ResponseDeps } from '../responses'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const NOW = new Date('2026-10-08T01:00:00.000Z')
const IP = '203.0.113.1'
const REVIEW_URL = 'https://search.google.com/local/writereview?placeid=p-st-1'
const CLOSED = { code: 'failed-precondition', message: '現在このアンケートは受け付けていません。' }

let slug = ''
let surveyId = ''

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }] })
  await seedStore(db, ORG, 'st-1', '渋谷店')
  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: REVIEW_URL })
  surveyId = (await createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: '来店アンケート', content: sampleContent() })).id
  await updateSurveyPublishFunc(db, OWNER, { orgId: ORG, surveyId })
  slug = (await db.doc(`organizations/${ORG}/surveys/${surveyId}`).get()).get('publicSlug')
})

function deps(now = NOW): ResponseDeps {
  return { now: () => now, ipHashSalt: () => 'test-salt' }
}

function post(submissionId: string, answers: Record<string, unknown>, options: { now?: Date; ip?: string | null } = {}) {
  return postSurveyResponseFunc(db, { slug, submissionId, answers }, { ip: options.ip === undefined ? IP : options.ip }, deps(options.now))
}

const responseCount = async () => (await db.collection(`organizations/${ORG}/responses`).get()).size
const usage = async () => (await db.doc(`organizations/${ORG}/usageMonthly/202610`).get()).get('responses')
const later = (ms: number) => new Date(NOW.getTime() + ms)

test('postSurveyResponse: 条件を満たせば口コミ URL を返し、回答と使用回数を保存する', async () => {
  const result = await post('sub-1', { 'q-overall': 5, 'q-comment': ' おいしかった ' })
  assert.deepEqual(result, { responseId: 'sub-1', isEligible: true, reviewUrl: REVIEW_URL })

  const saved = (await db.doc(`organizations/${ORG}/responses/sub-1`).get()).data()!
  assert.equal(saved.orgId, ORG)
  assert.equal(saved.surveyId, surveyId)
  assert.equal(saved.storeId, 'st-1')
  assert.equal(saved.surveyVersion, 1)
  assert.deepEqual(saved.answers, { 'q-overall': 5, 'q-comment': 'おいしかった' })
  assert.equal(saved.isEligible, true)
  assert.equal(saved.reviewDraft, null)
  assert.equal(saved.redirectedAt, null)
  assert.equal(saved.createdAt.toDate().toISOString(), NOW.toISOString())
  assert.equal(saved.ipHash, hashIp('test-salt', IP))
  assert.equal(saved.reviewUrl, undefined)
  assert.equal(await usage(), 1)

  // IP がとれない場合は unknown のハッシュ
  await post('sub-2', { 'q-overall': 3 }, { ip: null })
  assert.equal((await db.doc(`organizations/${ORG}/responses/sub-2`).get()).get('ipHash'), hashIp('test-salt', null))
  assert.equal(await usage(), 2)
})

test('postSurveyResponse: 条件を満たさなければ口コミ URL を返さない', async () => {
  assert.deepEqual(await post('sub-1', { 'q-overall': 2 }), { responseId: 'sub-1', isEligible: false, reviewUrl: null })
  assert.equal(await usage(), 1)
})

test('postSurveyResponse: 同じ submissionId の再送は 1 件のまま、保存済みの結果を返す', async () => {
  const first = await post('sub-1', { 'q-overall': 5 })
  assert.deepEqual(await post('sub-1', { 'q-overall': 1 }), first)
  assert.equal(await responseCount(), 1)
  assert.equal(await usage(), 1)
})

test('postSurveyResponse: 送信後に一時停止されても、同じ submissionId の再送は保存済みの結果を返す（Review Focus 2）', async () => {
  const first = await post('sub-1', { 'q-overall': 5 })
  await updateSurveyStatusFunc(db, OWNER, { orgId: ORG, surveyId, action: 'pause' })
  assert.deepEqual(await post('sub-1', { 'q-overall': 5 }), first)
  await assert.rejects(post('sub-2', { 'q-overall': 5 }), CLOSED)
  assert.equal(await responseCount(), 1)
})

test('postSurveyResponse: 期間外・終了後・存在しない slug は受け付けない', async () => {
  const period = (startAt: string | null, endAt: string | null) =>
    updateSurveyPeriodFunc(db, OWNER, { orgId: ORG, surveyId, publishPeriod: { startAt, endAt } })
  const outOfPeriod = { code: 'failed-precondition', message: '回答の受付期間外です。' }

  await period('2026-10-08T01:00:01.000Z', null)
  await assert.rejects(post('sub-1', { 'q-overall': 5 }), outOfPeriod)
  await period(null, '2026-10-08T00:59:59.000Z')
  await assert.rejects(post('sub-1', { 'q-overall': 5 }), outOfPeriod)
  await period('2026-10-08T01:00:00.000Z', '2026-10-08T01:00:00.001Z')
  await post('sub-1', { 'q-overall': 5 })

  await updateSurveyStatusFunc(db, OWNER, { orgId: ORG, surveyId, action: 'close' })
  await assert.rejects(post('sub-2', { 'q-overall': 5 }), CLOSED)
  await assert.rejects(postSurveyResponseFunc(db, { slug: 'nothing', submissionId: 'sub-3', answers: {} }, { ip: IP }, deps()), CLOSED)
  await assert.rejects(postSurveyResponseFunc(db, { slug, submissionId: '../x', answers: {} }, { ip: IP }, deps()), { code: 'invalid-argument' })
  assert.equal(await responseCount(), 1)
})

test('postSurveyResponse: 回答の検証に失敗したら保存せず、レート制限にも数えない', async () => {
  await assert.rejects(post('sub-1', {}), { code: 'invalid-argument', message: '「満足度」は必須です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 6 }), { message: '評価の値が不正です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 5, 'q-good': ['o-none'] }), { message: '選択肢の値が不正です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 5, 'q-comment': 'あ'.repeat(501) }), { message: '自由記述は 500 文字以内で入力してください。' })
  assert.equal(await responseCount(), 0)
  assert.equal((await db.collection('rateLimits').get()).size, 0)
})

test('postSurveyResponse: 同じ接続元から 10 分に 5 件まで。6 件目は拒否、別の接続元と 10 分後は受け付ける', async () => {
  for (let index = 1; index <= 5; index++) await post(`sub-${index}`, { 'q-overall': 5 }, { now: later(index * 1000) })
  await assert.rejects(
    post('sub-6', { 'q-overall': 5 }, { now: later(6000) }),
    { code: 'resource-exhausted', message: '短時間に多くの回答が送られました。しばらくしてから再度お試しください。' },
  )
  await post('sub-7', { 'q-overall': 5 }, { now: later(6000), ip: '198.51.100.7' })
  // 1 件目（NOW + 1 秒）から 10 分と 1 ミリ秒後
  await post('sub-8', { 'q-overall': 5 }, { now: later(1000 + 10 * 60 * 1000 + 1) })

  assert.equal(await responseCount(), 7)
  const limit = await db.doc(`rateLimits/${slug}_${hashIp('test-salt', IP)}`).get()
  assert.equal((limit.get('hits') as Timestamp[]).length, 5)
})

test('postReviewRedirect: 条件を満たした回答だけ遷移日時を記録する（記録済みなら変えない）', async () => {
  await post('sub-ok', { 'q-overall': 5 })
  await post('sub-ng', { 'q-overall': 1 })

  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ok' }, deps(new Date('2026-10-08T01:05:00.000Z')))
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ok' }, deps(new Date('2026-10-08T02:00:00.000Z')))
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ng' }, deps())
  // 対象が無くてもエラーにしない
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-none' }, deps())
  await postReviewRedirectFunc(db, { slug: 'nothing', submissionId: 'sub-ok' }, deps())

  const redirectedAt = async (id: string) => (await db.doc(`organizations/${ORG}/responses/${id}`).get()).get('redirectedAt')
  assert.equal((await redirectedAt('sub-ok')).toDate().toISOString(), '2026-10-08T01:05:00.000Z')
  assert.equal(await redirectedAt('sub-ng'), null)
  await assert.rejects(postReviewRedirectFunc(db, { slug, submissionId: '../x' }, deps()), { code: 'invalid-argument' })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL。`callable.test.ts` のコンパイルで `Module '"../callable"' has no exported member 'clientIpOf'`（`responses.itest.ts` も `Cannot find module '../responses'`）が出る。

- [ ] **Step 3: publicCallable に接続元の IP を渡す**

`functions/src/shared/callable.ts`（全体を置き換え）:

```ts
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { onCall, type CallableOptions } from 'firebase-functions/https'
import { requireCaller, type Caller } from './auth'

export type Handler<T> = (db: Firestore, caller: Caller, data: unknown) => Promise<T>

/** ログイン不要の callable に渡す、呼び出し元の情報 */
export interface PublicContext {
  /** 接続元の IP（request.rawRequest.ip）。とれなければ null */
  ip: string | null
}

/** ログイン必須の callable。長い処理は options で timeoutSeconds を指定する */
export function callable<T>(handler: Handler<T>, options: CallableOptions = {}) {
  return onCall(options, request => handler(getFirestore(), requireCaller(request), request.data))
}

export function clientIpOf(rawRequest: { ip?: string } | undefined): string | null {
  return rawRequest?.ip || null
}

/** ログイン不要の callable（招待の確認・アンケートの回答など） */
export function publicCallable<T>(handler: (db: Firestore, data: unknown, context: PublicContext) => Promise<T>) {
  return onCall(request => handler(getFirestore(), request.data, { ip: clientIpOf(request.rawRequest) }))
}
```

- [ ] **Step 4: 使用回数の加算を作る**

`functions/src/responses/usage.ts`:

```ts
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { toJstMonthKey } from '../rankings/validation'

// 今月の回答数（organizations/{orgId}/usageMonthly/{YYYYMM}.responses）。受け付けた回答を 1 件ずつ数える（月は JST）

export function addResponseUsage(tx: Transaction, db: Firestore, orgId: string, now: Date): void {
  const month = toJstMonthKey(now)
  tx.set(db.doc(`organizations/${orgId}/usageMonthly/${month}`), { orgId, month, responses: FieldValue.increment(1) }, { merge: true })
}
```

- [ ] **Step 5: 回答の受付と遷移の記録を実装する**

`functions/src/responses/responses.ts`:

```ts
import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import type { PublicContext } from '../shared/callable'
import { fail } from '../shared/errors'
import { asObject, requireId } from '../shared/validation'
import { isWithinPeriod, toPeriod } from '../surveys/period'
import { publicSurveyRef, versionRef, type PublicSurveyDoc } from '../surveys/publicSurvey'
import type { SurveyContent } from '../surveys/types'
import { requireAnswers } from './answers'
import { evaluateRedirectRule } from './evaluateRedirectRule'
import { getIpHashSalt, hashIp } from './ipHash'
import { nextRateLimitHits } from './rateLimit'
import { addResponseUsage } from './usage'

// responses/ … 回答の受付と Google 口コミへの遷移の記録（docs/04-features.md F-10〜F-13。ログイン不要）

const CLOSED_MESSAGE = '現在このアンケートは受け付けていません。'

/** 現在時刻と IP ハッシュのソルト。テストで差し替える */
export interface ResponseDeps {
  now(): Date
  ipHashSalt(): string
}

export const defaultResponseDeps: ResponseDeps = { now: () => new Date(), ipHashSalt: getIpHashSalt }

export interface PostSurveyResponseResult {
  responseId: string
  isEligible: boolean
  /** 条件を満たしたときだけ店舗の口コミ URL */
  reviewUrl: string | null
}

/**
 * 回答を受け付ける。再送の確認・受付状態と期間・回答の検証・レート制限・遷移ルールの判定・保存・使用回数の加算を
 * 1 つのトランザクションで行う
 */
export async function postSurveyResponseFunc(
  db: Firestore,
  data: unknown,
  context: PublicContext,
  deps: ResponseDeps = defaultResponseDeps,
): Promise<PostSurveyResponseResult> {
  const input = asObject(data)
  const slug = requireId(input.slug, 'アンケートの URL')
  const submissionId = requireId(input.submissionId, '回答 ID')
  const now = deps.now()
  const ipHash = hashIp(deps.ipHashSalt(), context.ip)

  return db.runTransaction(async (tx) => {
    const found = await tx.get(publicSurveyRef(db, slug))
    if (!found.exists) fail('failed-precondition', CLOSED_MESSAGE)
    const survey = found.data() as PublicSurveyDoc
    const responseRef = db.doc(`organizations/${survey.orgId}/responses/${submissionId}`)
    const existing = await tx.get(responseRef)
    const store = await tx.get(db.doc(`organizations/${survey.orgId}/stores/${survey.storeId}`))
    // reviewUrl は回答に保存しない。条件を満たしたときだけ店舗から読んで返す
    const resultOf = (isEligible: boolean): PostSurveyResponseResult => ({
      responseId: submissionId,
      isEligible,
      reviewUrl: isEligible ? (store.get('reviewUrl') as string | undefined) || null : null,
    })

    // 再送（同じ submissionId）は、受付を止めた後でも保存済みの結果を返す
    if (existing.exists) {
      if (existing.get('surveyId') !== survey.surveyId) fail('already-exists', 'この回答はすでに送信されています。')
      return resultOf(existing.get('isEligible') === true)
    }
    if (survey.status !== 'published') fail('failed-precondition', CLOSED_MESSAGE)
    if (!isWithinPeriod(toPeriod(survey.publishPeriod), now)) fail('failed-precondition', '回答の受付期間外です。')

    // 遷移ルールは回答画面に渡していないため、公開版から読む
    const version = await tx.get(versionRef(db, survey.orgId, survey.surveyId, survey.version))
    if (!version.exists) fail('not-found', 'アンケートが見つかりません。')
    const content = version.get('content') as SurveyContent
    const answers = requireAnswers(content.questions, input.answers)

    const limitRef = db.doc(`rateLimits/${slug}_${ipHash}`)
    const stored = ((await tx.get(limitRef)).get('hits') ?? []) as Timestamp[]
    const hits = nextRateLimitHits(stored.map(hit => hit.toDate()), now)

    const isEligible = evaluateRedirectRule(content.redirectRule, answers)
    tx.set(limitRef, { hits })
    tx.create(responseRef, {
      orgId: survey.orgId,
      surveyId: survey.surveyId,
      storeId: survey.storeId,
      surveyVersion: survey.version,
      answers,
      isEligible,
      reviewDraft: null,
      redirectedAt: null,
      createdAt: now,
      ipHash,
    })
    addResponseUsage(tx, db, survey.orgId, now)
    return resultOf(isEligible)
  })
}

/** 「Google に口コミを書く」を押したことの記録。条件を満たした回答だけ、最初の 1 回を残す。実際に投稿されたかは分からない */
export async function postReviewRedirectFunc(db: Firestore, data: unknown, deps: ResponseDeps = defaultResponseDeps): Promise<void> {
  const input = asObject(data)
  const slug = requireId(input.slug, 'アンケートの URL')
  const submissionId = requireId(input.submissionId, '回答 ID')
  const survey = await publicSurveyRef(db, slug).get()
  if (!survey.exists) return
  const ref = db.doc(`organizations/${survey.get('orgId')}/responses/${submissionId}`)
  await db.runTransaction(async (tx) => {
    const response = await tx.get(ref)
    if (!response.exists || response.get('surveyId') !== survey.get('surveyId')) return
    if (response.get('isEligible') !== true || response.get('redirectedAt')) return
    tx.update(ref, { redirectedAt: deps.now() })
  })
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm --prefix functions test && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: 単体テストも結合テストもすべて PASS（既存の `getInvitation` の結合テストも PASS）

- [ ] **Step 7: 確認**

Run: `git status --short functions/src`
Expected: `shared/callable.ts` の変更、`shared/__tests__/callable.test.ts`、`responses/usage.ts`、`responses/responses.ts`、`responses/__tests__/responses.itest.ts` が表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 8: 店舗のアーカイブでアンケートを終了する

**Files:**
- Modify: `functions/src/stores/stores.ts`（import と `updateStoreArchiveFunc`）
- Test: `functions/src/stores/__tests__/stores.itest.ts`（末尾に追加）

**Interfaces:**
- Consumes: Task 5 の `surveysOf` / `publicSurveyRef`
- Produces: `updateStoreArchiveFunc(db, caller, data) => Promise<void>`（シグネチャは変えない）。店舗をアーカイブし、その店舗の `published` / `paused` のアンケートを `closed` にして `publicSurveys` を削除する。監査ログの payload に `closedSurveyIds` を加える。

> 仕様書 2.4 は「モック `google.ts:116-126` と同じ動き」としているが、実際のモックは `published` を `paused` にするだけで、`closed` にはしない。ここでは仕様書に明記された「`closed` にし、`publicSurveys` を削除する」に従う。終了すれば件数の上限からも外れ、アーカイブ済みの店舗のアンケートを再開できなくなるため。モックは変更しない（モックの既存動作を変えない）。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/stores/__tests__/stores.itest.ts` の末尾に追加する:

```ts
test('updateStoreArchive: 店舗の公開中・停止中のアンケートを終了し、公開データを消す（下書きと他店舗は変えない）', async () => {
  await db.doc('organizations/org-a/stores/st-111').set({ orgId: 'org-a', name: '渋谷店', status: 'active' })
  const surveys = [
    ['sv-published', 'st-111', 'published'],
    ['sv-paused', 'st-111', 'paused'],
    ['sv-draft', 'st-111', 'draft'],
    ['sv-other', 'st-333', 'published'],
  ] as const
  for (const [id, storeId, status] of surveys) {
    await db.doc(`organizations/org-a/surveys/${id}`).set({ orgId: 'org-a', storeId, status, publicSlug: `slug-${id}` })
    if (status !== 'draft') await db.doc(`publicSurveys/slug-${id}`).set({ orgId: 'org-a', surveyId: id, storeId, status })
  }

  await updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-111' })

  const statusOf = async (id: string) => (await db.doc(`organizations/org-a/surveys/${id}`).get()).get('status')
  const isPublic = async (id: string) => (await db.doc(`publicSurveys/slug-${id}`).get()).exists
  assert.equal(await statusOf('sv-published'), 'closed')
  assert.equal(await statusOf('sv-paused'), 'closed')
  assert.equal(await isPublic('sv-published'), false)
  assert.equal(await isPublic('sv-paused'), false)
  assert.equal(await statusOf('sv-draft'), 'draft')
  assert.equal(await statusOf('sv-other'), 'published')
  assert.equal(await isPublic('sv-other'), true)
  const audit = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'store.archive').get()).docs[0]!
  assert.deepEqual([...audit.get('payload.closedSurveyIds')].sort(), ['sv-paused', 'sv-published'])
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL。`sv-published` の状態が `'published'` のまま（`expected 'closed'`）。

- [ ] **Step 3: 実装する**

`functions/src/stores/stores.ts` の import に追加する（`import { asObject, requireId, requireStringArray } from '../shared/validation'` の下）:

```ts
import { publicSurveyRef, surveysOf } from '../surveys/publicSurvey'
```

`updateStoreArchiveFunc` を次の内容に置き換える:

```ts
/** 店舗をアーカイブする。その店舗の公開中・停止中のアンケートは終了し、回答画面の公開データを消す */
export async function updateStoreArchiveFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const ref = db.doc(`organizations/${orgId}/stores/${storeId}`)
    if (!(await tx.get(ref)).exists) fail('not-found', '店舗が見つかりません。')
    const openSurveys = await tx.get(surveysOf(db, orgId).where('storeId', '==', storeId).where('status', 'in', ['published', 'paused']))
    tx.update(ref, { status: 'archived', archivedAt: FieldValue.serverTimestamp() })
    for (const survey of openSurveys.docs) {
      tx.update(survey.ref, { status: 'closed', updatedAt: FieldValue.serverTimestamp() })
      tx.delete(publicSurveyRef(db, survey.get('publicSlug')))
    }
    writeAuditLog(tx, db, orgId, 'store.archive', caller.uid, { storeId, closedSurveyIds: openSurveys.docs.map(survey => survey.id) })
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（既存の「updateStoreArchive: owner / admin が店舗をアーカイブする。staff は不可」も PASS）

- [ ] **Step 5: 確認**

Run: `git diff --stat functions/src/stores`
Expected: `stores.ts` と `__tests__/stores.itest.ts` の 2 ファイルが変更されている。コミットはユーザーの許可がある場合のみ行う。

---

### Task 9: Functions の export とビルド

**Files:**
- Modify: `functions/src/index.ts`（import と末尾の export）

**Interfaces:**
- Consumes: Task 5〜7 のハンドラー
- Produces: export 名
  - 管理側（ログイン必須）：`createSurvey` / `createSurveyCopy` / `updateSurveyDraft` / `updateSurveyPublish` / `updateSurveyStatus` / `updateSurveySlug` / `updateSurveyPeriod` / `getResponsesCsv`
  - 回答側（ログイン不要）：`postSurveyResponse` / `postReviewRedirect`

- [ ] **Step 1: export を追加する**

`functions/src/index.ts` の import に追加する（`import { createReplyTemplateFunc, ... } from "./gbp/templates";` の下）:

```ts
import {
  createSurveyCopyFunc,
  createSurveyFunc,
  updateSurveyDraftFunc,
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
} from "./surveys/surveys";
import { getResponsesCsvFunc } from "./surveys/responsesCsv";
import { postReviewRedirectFunc, postSurveyResponseFunc } from "./responses/responses";
```

ファイル末尾（`scheduledRankCheck` の後ろ）に追加する:

```ts
// surveys/ … アンケートの管理（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 2.1）
export const createSurvey = callable(createSurveyFunc);
export const createSurveyCopy = callable(createSurveyCopyFunc);
export const updateSurveyDraft = callable(updateSurveyDraftFunc);
export const updateSurveyPublish = callable(updateSurveyPublishFunc);
export const updateSurveyStatus = callable(updateSurveyStatusFunc);
export const updateSurveySlug = callable(updateSurveySlugFunc);
export const updateSurveyPeriod = callable(updateSurveyPeriodFunc);
export const getResponsesCsv = callable(getResponsesCsvFunc);

// responses/ … 回答の受付（2.2・2.3。ログイン不要）。deps は既定値を使うため、引数を明示して渡す
export const postSurveyResponse = publicCallable((db, data, context) => postSurveyResponseFunc(db, data, context));
export const postReviewRedirect = publicCallable((db, data) => postReviewRedirectFunc(db, data));
```

- `postReviewRedirectFunc` の 3 番目の引数は `deps`。`publicCallable` は 3 番目に `context` を渡すため、`publicCallable(postReviewRedirectFunc)` と直接渡してはいけない（型エラーになる）。

- [ ] **Step 2: ビルドとテストが通ることを確認する**

Run: `npm --prefix functions run build && npm --prefix functions test && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: `tsc` がエラーなく終わり、単体テストも結合テストもすべて PASS。

Run: `grep -c "region" functions/src/surveys/*.ts functions/src/responses/*.ts`
Expected: すべて `0`（region は `setGlobalOptions` のまま）。

- [ ] **Step 3: 確認**

Run: `git diff --stat functions/src/index.ts`
Expected: `index.ts` に import と export の追加だけの差分が出る。コミットはユーザーの許可がある場合のみ行う。

---

### Task 10: 本物モードの変換と購読

**Files:**
- Modify: `app/utils/firebase/converters.ts`（型の import と末尾に追加）
- Modify: `app/composables/useFirestoreSync.ts`
- 確認のみ: `app/utils/firebase/emptyDb.ts`

**Interfaces:**
- Consumes: Firestore のドキュメントの形（Global Constraints「データの配置」）
- Produces:
  - `toSurvey(id: string, orgId: string, data: DocumentData): Survey`
  - `toSurveyVersion(data: DocumentData): SurveyVersion`
  - `toSurveyResponse(id: string, data: DocumentData): SurveyResponse`（`reviewDraft` は常に `null`。`ipHash` は読まない）
  - `toPublicSurvey(data: DocumentData): PublicSurvey`
  - 購読：`db.value.surveys` / `db.value.surveyVersions` / `db.value.responses`（本物モード）

- [ ] **Step 1: 変換を追加する**

`app/utils/firebase/converters.ts` の型の import に `PublicSurvey, PublishPeriod, Survey, SurveyResponse, SurveyVersion` を加える:

```ts
import type { GbpPost, GbpProfile, GbpReview, GoogleConnection, Invitation, Member, Organization, PublicSurvey, PublishPeriod, RankKeyword, RankResultsDoc, RankSearch, RankSnapshot, ReplyTemplate, Store, Survey, SurveyResponse, SurveyVersion, User } from '~/types/domain'
```

ファイル末尾に追加する:

```ts
/** 公開期間（Firestore では Timestamp | null） */
function toPublishPeriod(value: DocumentData | undefined): PublishPeriod {
  return {
    startAt: value?.startAt ? toIso(value.startAt) : null,
    endAt: value?.endAt ? toIso(value.endAt) : null,
  }
}

export function toSurvey(id: string, orgId: string, data: DocumentData): Survey {
  return {
    id,
    orgId,
    storeId: data.storeId,
    title: data.title,
    status: data.status,
    publicSlug: data.publicSlug,
    draft: data.draft,
    currentVersion: data.currentVersion ?? null,
    hasUnpublishedChanges: data.hasUnpublishedChanges === true,
    publishPeriod: toPublishPeriod(data.publishPeriod),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

export function toSurveyVersion(data: DocumentData): SurveyVersion {
  return {
    orgId: data.orgId,
    surveyId: data.surveyId,
    version: data.version,
    content: data.content,
    publishedBy: data.publishedBy,
    publishedAt: toIso(data.publishedAt),
  }
}

/** ipHash はサーバーだけが使うので読まない。文面の生成は作らないため reviewDraft は常に null */
export function toSurveyResponse(id: string, data: DocumentData): SurveyResponse {
  return {
    id,
    orgId: data.orgId,
    surveyId: data.surveyId,
    storeId: data.storeId,
    surveyVersion: data.surveyVersion,
    answers: data.answers ?? {},
    isEligible: data.isEligible === true,
    reviewDraft: null,
    redirectedAt: data.redirectedAt ? toIso(data.redirectedAt) : null,
    createdAt: toIso(data.createdAt),
  }
}

export function toPublicSurvey(data: DocumentData): PublicSurvey {
  return {
    slug: data.slug,
    orgId: data.orgId,
    surveyId: data.surveyId,
    storeId: data.storeId,
    version: data.version,
    storeName: data.storeName ?? '',
    questions: data.questions ?? [],
    design: data.design,
    status: data.status,
    publishPeriod: toPublishPeriod(data.publishPeriod),
  }
}
```

- [ ] **Step 2: 購読を追加する**

`app/composables/useFirestoreSync.ts`:

1. 型の import に `Survey, SurveyResponse, SurveyVersion` を、converters の import に `toSurvey, toSurveyResponse, toSurveyVersion` を加える。
2. 冒頭のコメント `// ・表示中の組織: メンバー・店舗、owner / admin なら招待と Google 連携も` の下に 1 行追加する:

```ts
// ・アンケート: surveys / surveyVersions は組織のものすべて、responses は直近 90 日・最大 2,000 件（publicSurveys は購読しない）
```

3. `const rankSearches = new MirrorCollection...` の下に追加する:

```ts
  const surveys = new MirrorCollection<Survey>(item => item.id, (items) => { db.value.surveys = items })
  const surveyVersions = new MirrorCollection<SurveyVersion>(item => `${item.surveyId}_${item.version}`, (items) => { db.value.surveyVersions = items })
  const responses = new MirrorCollection<SurveyResponse>(item => item.id, (items) => { db.value.responses = items })
```

4. `resetAll` の配列 `[organizations, members, stores, invitations, connections, profiles, reviews, posts, templates, rankKeywords, rankSnapshots, rankSearches]` の末尾に `surveys, surveyVersions, responses` を加える。`watchCurrentOrg` の `[stores, invitations, connections, profiles, reviews, posts, templates, rankKeywords, rankSnapshots, rankSearches]` の末尾にも同じ 3 つを加える。
5. `const RANK_SEARCH_LIMIT = 30` の下に追加する:

```ts
  /** 回答は直近 90 日・新しい順に最大 2,000 件。それより前は CSV（getResponsesCsv）で確認する */
  const RESPONSE_DAYS = 90
  const RESPONSE_LIMIT = 2000
```

6. `watchCurrentOrg` の `watchStoreScoped(orgId, member, 'rankSnapshots', ...)` の行の下に追加する:

```ts
    watchStoreScoped(orgId, member, 'surveys', surveys, (id, data) => toSurvey(id, orgId, data))
    watchStoreScoped(orgId, member, 'surveyVersions', surveyVersions, (_, data) => toSurveyVersion(data))
    // staff は storeId in ＋ createdAt の降順（インデックス responses (storeId, createdAt DESC)）
    const responseFrom = new Date(Date.now() - RESPONSE_DAYS * 86_400_000)
    watchStoreScoped(orgId, member, 'responses', responses, toSurveyResponse, [where('createdAt', '>=', responseFrom), orderBy('createdAt', 'desc'), limit(RESPONSE_LIMIT)])
```

- [ ] **Step 3: 空の DB を確認する**

Run: `grep -n "surveys\|surveyVersions\|publicSurveys\|responses" app/utils/firebase/emptyDb.ts`
Expected: `surveys: []`、`surveyVersions: []`、`publicSurveys: []`、`responses: []` の 4 行が出る（変更不要）。

- [ ] **Step 4: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 5: 確認**

Run: `git diff --stat app/utils/firebase/converters.ts app/composables/useFirestoreSync.ts`
Expected: 2 ファイルに追加分だけの差分が出る。コミットはユーザーの許可がある場合のみ行う。

---

### Task 11: 管理側の composable（一覧・作成・複製・公開管理・回答一覧と CSV）

**Files:**
- Modify（全体を置き換え）: `app/composables/useSurveys.ts`
- Modify（全体を置き換え）: `app/composables/useSurveyPublish.ts`
- Modify（全体を置き換え）: `app/composables/useResponses.ts`
- Modify: `app/pages/admin/[orgId]/surveys/[surveyId]/responses.vue`

**Interfaces:**
- Consumes: Task 9 の export 名、Task 10 の購読（`db.value.surveys` / `surveyVersions` / `responses`）
- Produces:
  - `useSurveys()`：返り値 `{ surveys, findSurvey, responseCount, createSurvey, copySurvey }`
    - `createSurvey(input: { storeId: string; title: string; content: SurveyContent }): Promise<{ id: string }>`
    - `copySurvey(surveyId: string, storeId: string): Promise<{ id: string }>`
    - 本物モードでは、作ったアンケートが購読に届くまで（最大 10 秒）待ってから返す（Review Focus 1）
  - `useSurveyPublish(surveyId)`：返り値 `{ survey, store, versions, publishErrors, publicUrl, publish, changeStatus, regenerateSlug, updatePeriod }`
    - `publish(): Promise<{ version: number }>`
    - `changeStatus(action: SurveyStatusAction): Promise<{ status: SurveyStatus }>`
    - `regenerateSlug(): Promise<string>`
    - `updatePeriod(period: PublishPeriod): Promise<void>`
  - `useResponses(surveyId)`：返り値に `isWindowed: boolean` を追加（本物モードで true）
  - `RESPONSE_WINDOW_NOTICE`（`useResponses.ts` の export）

- [ ] **Step 1: `useSurveys` を置き換える**

`app/composables/useSurveys.ts`:

```ts
import type { SurveyContent, SurveyStatus } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { mockLatency } from '~/utils/mock/functions/shared'
import { createSurveyCopyFunc, createSurveyFunc } from '~/utils/mock/functions/surveys'

// F-06 アンケート一覧・作成・複製

/** 本物モードで、作ったアンケートが購読に届くまで待つ上限 */
const SYNC_WAIT_MS = 10_000

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: '下書き',
  published: '公開中',
  paused: '一時停止',
  closed: '終了',
}

export function useSurveys() {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore } = useCurrentOrg()

  /** 自分が見られるアンケート（staff は担当店舗のみ）。更新日の新しい順 */
  const surveys = computed(() =>
    db.value.surveys
      .filter(survey => survey.orgId === orgId.value && canAccessStore(survey.storeId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))

  function findSurvey(surveyId: string) {
    return computed(() => surveys.value.find(survey => survey.id === surveyId) ?? null)
  }

  function responseCount(surveyId: string): number {
    return db.value.responses.filter(response => response.surveyId === surveyId).length
  }

  /** 作成直後に編集画面へ移ると、購読が届く前で「見つかりません」になるため、届くまで待つ */
  function waitForSurvey(surveyId: string): Promise<void> {
    const isSynced = () => db.value.surveys.some(survey => survey.id === surveyId)
    if (isSynced()) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(isSynced, (value) => { if (value) finish() })
      const timer = setTimeout(finish, SYNC_WAIT_MS)
      function finish(): void {
        clearTimeout(timer)
        stop()
        resolve()
      }
    })
  }

  async function createSurvey(input: { storeId: string; title: string; content: SurveyContent }): Promise<{ id: string }> {
    if (!isMock) {
      const created = await callFunction<object, { id: string }>($functions, 'createSurvey', { orgId: orgId.value, ...input })
      await waitForSurvey(created.id)
      return created
    }
    await mockLatency()
    return createSurveyFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
  }

  async function copySurvey(surveyId: string, storeId: string): Promise<{ id: string }> {
    if (!isMock) {
      const created = await callFunction<object, { id: string }>($functions, 'createSurveyCopy', { orgId: orgId.value, surveyId, storeId })
      await waitForSurvey(created.id)
      return created
    }
    await mockLatency()
    return createSurveyCopyFunc(db.value, user.value!.uid, orgId.value, surveyId, storeId)
  }

  return { surveys, findSurvey, responseCount, createSurvey, copySurvey }
}
```

- [ ] **Step 2: `useSurveyPublish` を置き換える**

`app/composables/useSurveyPublish.ts`:

```ts
import type { PublishPeriod, SurveyStatus, SurveyStatusAction } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { mockLatency } from '~/utils/mock/functions/shared'
import {
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
  validateSurveyForPublish,
} from '~/utils/mock/functions/surveys'

// F-09 公開管理（公開・一時停止・再開・終了・期間・URL 再発行）

export function useSurveyPublish(surveyId: string) {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()

  const survey = computed(() => db.value.surveys.find(item => item.id === surveyId && item.orgId === orgId.value) ?? null)
  const store = computed(() => db.value.stores.find(item => item.id === survey.value?.storeId))
  const versions = computed(() =>
    db.value.surveyVersions
      .filter(item => item.surveyId === surveyId)
      .sort((a, b) => b.version - a.version))

  /** 公開前チェックで見つかった問題（空なら公開できる）。表示用で、最終的な判定は Functions が行う */
  const publishErrors = computed(() => survey.value ? validateSurveyForPublish(survey.value.draft, store.value) : [])

  const publicUrl = computed(() => survey.value ? `${window.location.origin}/s/${survey.value.publicSlug}` : '')

  const target = () => ({ orgId: orgId.value, surveyId })

  async function publish(): Promise<{ version: number }> {
    if (!isMock) return callFunction<object, { version: number }>($functions, 'updateSurveyPublish', target())
    await mockLatency()
    const published = updateSurveyPublishFunc(db.value, user.value!.uid, orgId.value, surveyId)
    return { version: published.currentVersion ?? 1 }
  }

  async function changeStatus(action: SurveyStatusAction): Promise<{ status: SurveyStatus }> {
    if (!isMock) return callFunction<object, { status: SurveyStatus }>($functions, 'updateSurveyStatus', { ...target(), action })
    await mockLatency()
    return { status: updateSurveyStatusFunc(db.value, user.value!.uid, orgId.value, surveyId, action).status }
  }

  async function regenerateSlug(): Promise<string> {
    if (!isMock) return (await callFunction<object, { slug: string }>($functions, 'updateSurveySlug', target())).slug
    await mockLatency()
    return updateSurveySlugFunc(db.value, user.value!.uid, orgId.value, surveyId)
  }

  async function updatePeriod(period: PublishPeriod): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateSurveyPeriod', { ...target(), publishPeriod: period })
      return
    }
    await mockLatency()
    updateSurveyPeriodFunc(db.value, user.value!.uid, orgId.value, surveyId, period)
  }

  return { survey, store, versions, publishErrors, publicUrl, publish, changeStatus, regenerateSlug, updatePeriod }
}
```

- 公開管理の画面（`[surveyId]/index.vue`）は `run(publish)` などの結果を「truthy なら成功」としか見ていないため、変更しない。

- [ ] **Step 3: `useResponses` を置き換える**

`app/composables/useResponses.ts`:

```ts
import type { Question, SurveyResponse } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { getResponsesCsvFunc } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-14 回答一覧・集計・CSV

export const PAGE_SIZE = 25

/** 本物モードの回答一覧に出す注意書き（useFirestoreSync は直近 90 日・最大 2,000 件だけを購読する） */
export const RESPONSE_WINDOW_NOTICE = '直近 90 日・最大 2,000 件を表示しています。それより前は CSV で確認してください'

export interface ResponseFilters {
  /** 直近の日数。null は全期間 */
  days: number | null
  eligibility: 'all' | 'eligible' | 'not-eligible'
  redirect: 'all' | 'redirected' | 'not-redirected'
}

export function useResponses(surveyId: string) {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore } = useCurrentOrg()

  /** 本物モードは購読の範囲（直近 90 日・2,000 件）だけを表示している */
  const isWindowed = !isMock

  const filters = reactive<ResponseFilters>({ days: 30, eligibility: 'all', redirect: 'all' })
  const page = ref(1)
  watch(filters, () => { page.value = 1 })

  const allResponses = computed(() =>
    db.value.responses
      .filter(item => item.surveyId === surveyId && item.orgId === orgId.value && canAccessStore(item.storeId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

  const filteredResponses = computed(() => {
    const since = filters.days === null ? 0 : Date.now() - filters.days * 86_400_000
    return allResponses.value.filter((item) => {
      if (Date.parse(item.createdAt) < since) return false
      if (filters.eligibility === 'eligible' && !item.isEligible) return false
      if (filters.eligibility === 'not-eligible' && item.isEligible) return false
      if (filters.redirect === 'redirected' && !item.redirectedAt) return false
      if (filters.redirect === 'not-redirected' && item.redirectedAt) return false
      return true
    })
  })

  const pageCount = computed(() => Math.max(1, Math.ceil(filteredResponses.value.length / PAGE_SIZE)))
  const pagedResponses = computed(() => filteredResponses.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

  /** 全バージョンの設問を ID でまとめる（バージョンをまたいだ集計・表示用） */
  const questions = computed(() => {
    const map = new Map<string, Question>()
    db.value.surveyVersions
      .filter(item => item.surveyId === surveyId)
      .sort((a, b) => a.version - b.version)
      .forEach(version => version.content.questions.forEach(question => map.set(question.id, question)))
    return [...map.values()]
  })

  /** 本物モードはサーバーで検索し直す（期間だけで絞り込む。最大 5,000 件） */
  async function fetchCsv(): Promise<string> {
    if (!isMock) {
      const from = filters.days === null ? null : new Date(Date.now() - filters.days * 86_400_000).toISOString()
      const { csv } = await callFunction<object, { csv: string }>($functions, 'getResponsesCsv', { orgId: orgId.value, surveyId, from })
      return csv
    }
    await mockLatency()
    return getResponsesCsvFunc(db.value, user.value!.uid, orgId.value, surveyId, filteredResponses.value)
  }

  async function downloadCsv(): Promise<void> {
    const csv = await fetchCsv()
    // Excel で文字化けしないよう BOM を付ける
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `responses-${surveyId}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return { filters, page, pageCount, allResponses, filteredResponses, pagedResponses, questions, isWindowed, downloadCsv }
}

/** 回答の値を表示用の文字列にする */
export function formatAnswer(question: Question, response: SurveyResponse): string {
  const answer = response.answers[question.id]
  if (answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)) return '—'
  if (question.type === 'single' || question.type === 'multi') {
    const ids = Array.isArray(answer) ? answer : [String(answer)]
    return ids.map(id => question.options.find(option => option.id === id)?.label ?? id).join('、')
  }
  if (question.type === 'rating') return `★${answer}`
  return String(answer)
}
```

- 既存の BOM は不可視文字（U+FEFF）をそのまま書いていたため、`'﻿'` のエスケープに変えた（中身は同じ）。
- 本物モードの CSV は、仕様書 2.1 の入力（`{ orgId, surveyId, storeId?, from?, to? }`）のとおり**期間だけ**で絞り込む。画面の「条件合致」「Google 遷移」の絞り込みは CSV には効かない（モックは画面で絞り込んだ回答を出す）。条件合致などの列は CSV に含まれるので、表計算ソフトで絞り込める。

- [ ] **Step 4: 回答一覧の画面に注意書きを出す**

`app/pages/admin/[orgId]/surveys/[surveyId]/responses.vue`:

1. `useResponses` の分割代入に `isWindowed` を加える:

```ts
const { filters, page, pageCount, filteredResponses, pagedResponses, questions, isWindowed, downloadCsv } = useResponses(surveyId)
```

2. CSV ボタンの `:is-disabled="filteredResponses.length === 0"` を `:is-disabled="!isWindowed && filteredResponses.length === 0"` に変える（本物モードでは、画面に無い 90 日より前の回答も CSV で出せるようにする）。
3. `<UiCommonAlert v-if="csv.errorMessage.value" tone="danger">{{ csv.errorMessage.value }}</UiCommonAlert>` の直後に追加する:

```vue
    <UiCommonAlert v-if="isWindowed" tone="info">{{ RESPONSE_WINDOW_NOTICE }}</UiCommonAlert>
```

- [ ] **Step 5: 型チェックと画面の確認（モックモード）**

Run: `npm run typecheck`
Expected: エラーなし。

Run: `npm run dev` で、モックの owner のアカウントで確認する（Playwright の `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_console_messages` を使う）。
- `/admin/{orgId}/surveys/new` で作成すると編集画面に移る。
- 一覧の「複製」で、複製したアンケートの編集画面に移る。
- 公開管理の画面で「公開」「一時停止」「再開」「URL 再発行」「公開期間の保存」がこれまでどおり動き、トーストが出る。
- 回答一覧の画面で「CSV をダウンロード」ができる。注意書き（直近 90 日・最大 2,000 件）は**出ない**（モックモードのため）。
- コンソールにエラーが出ていない。

- [ ] **Step 6: 確認**

Run: `git status --short app/composables app/pages`
Expected: `useSurveys.ts`・`useSurveyPublish.ts`・`useResponses.ts`・`responses.vue` が変更として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 12: 回答画面と案内画面

**Files:**
- Modify（全体を置き換え）: `app/composables/usePublicSurvey.ts`
- Modify（全体を置き換え）: `app/composables/useReviewDraft.ts`
- Modify: `app/pages/s/[slug]/index.vue`
- Modify（全体を置き換え）: `app/pages/s/[slug]/review.vue`

**Interfaces:**
- Consumes: Task 9 の `postSurveyResponse` / `postReviewRedirect`、Task 10 の `toPublicSurvey`
- Produces:
  - `type PublicSurveyAvailability = 'loading' | 'available' | 'not-found' | 'paused' | 'out-of-period'`
  - `interface SubmissionResult { responseId: string; isEligible: boolean; reviewUrl: string | null }`
  - `usePublicSurvey(slug)`：返り値 `{ snapshot, availability, lastResult, submit }`（`submit(answers: Answers): Promise<SubmissionResult>`）
  - `useReviewDraft(slug)`：返り値 `{ openGoogle }`（`openGoogle(responseId: string, reviewUrl: string): void`）

- [ ] **Step 1: `usePublicSurvey` を置き換える**

`app/composables/usePublicSurvey.ts`:

```ts
import { doc, getDoc } from 'firebase/firestore'
import type { Answers, PublicSurvey } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { toPublicSurvey } from '~/utils/firebase/converters'
import { postSurveyResponseFunc, isWithinPeriod } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-10 回答画面。公開スナップショット（publicSurveys）だけを読み、遷移条件は受け取らない。
// 本物モードは publicSurveys/{slug} を 1 回だけ読み（購読しない）、送信は postSurveyResponse（Functions）で行う。

export type PublicSurveyAvailability = 'loading' | 'available' | 'not-found' | 'paused' | 'out-of-period'

export interface SubmissionResult {
  responseId: string
  isEligible: boolean
  /** 条件を満たしたときだけ店舗の口コミ URL（案内画面で使う） */
  reviewUrl: string | null
}

function sessionKey(slug: string): string {
  return `meo-tool:submission:${slug}`
}

function readSession(slug: string): { submissionId: string; result: SubmissionResult | null } | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(slug))
    return raw ? JSON.parse(raw) : null
  }
  catch {
    return null
  }
}

function writeSession(slug: string, value: { submissionId: string; result: SubmissionResult | null }): void {
  try {
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(value))
  }
  catch {
    // 保存できなくても回答自体は送れる（再送時の重複防止だけが効かなくなる）
  }
}

export function usePublicSurvey(slug: string) {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { $db, $functions } = useNuxtApp()

  const loaded = ref<PublicSurvey | null>(null)
  const isLoading = ref(!isMock)

  async function load(): Promise<void> {
    try {
      const found = await getDoc(doc($db, 'publicSurveys', slug))
      loaded.value = found.exists() ? toPublicSurvey(found.data()) : null
    }
    catch {
      // 読めない（不正な slug・通信エラー）ときは「見つかりません」と同じ表示にする
      loaded.value = null
    }
    finally {
      isLoading.value = false
    }
  }
  if (!isMock) void load()

  const snapshot = computed<PublicSurvey | null>(() =>
    isMock ? db.value.publicSurveys.find(item => item.slug === slug) ?? null : loaded.value)
  const availability = computed<PublicSurveyAvailability>(() => {
    if (isLoading.value) return 'loading'
    if (!snapshot.value) return 'not-found'
    // 組織の利用停止中も、回答者には「受付停止中」と同じ表示にする
    if (snapshot.value.status !== 'published') return 'paused'
    if (!isWithinPeriod(snapshot.value.publishPeriod)) return 'out-of-period'
    return 'available'
  })

  /** 直前に送信した結果（口コミ画面・お礼画面の表示判定に使う） */
  const lastResult = ref<SubmissionResult | null>(readSession(slug)?.result ?? null)

  async function post(submissionId: string, answers: Answers): Promise<SubmissionResult> {
    if (!isMock) return callFunction<object, SubmissionResult>($functions, 'postSurveyResponse', { slug, submissionId, answers })
    await mockLatency(500)
    const posted = postSurveyResponseFunc(db.value, { slug, submissionId, answers })
    // モックの Functions は口コミ URL を返さないため、店舗から補う
    const store = db.value.stores.find(item => item.id === snapshot.value?.storeId)
    return { ...posted, reviewUrl: posted.isEligible ? store?.reviewUrl ?? null : null }
  }

  /**
   * 回答を送信する。submissionId をセッションに残し、通信エラーで再送しても 1 件にする。
   */
  async function submit(answers: Answers): Promise<SubmissionResult> {
    const stored = readSession(slug)
    const submissionId = stored && !stored.result ? stored.submissionId : crypto.randomUUID()
    writeSession(slug, { submissionId, result: null })
    const result = await post(submissionId, answers)
    writeSession(slug, { submissionId, result })
    lastResult.value = result
    return result
  }

  return { snapshot, availability, lastResult, submit }
}
```

- [ ] **Step 2: `useReviewDraft` を置き換える**

`app/composables/useReviewDraft.ts`:

```ts
import { callFunction } from '~/utils/firebase/callFunction'
import { postReviewRedirectFunc } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-13 Google 口コミへの遷移。
// 口コミ文面の生成（F-12）は今回は作らない（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 0 章）。
// 案内画面には「Google に口コミを書く」ボタンだけを置く

export function useReviewDraft(slug: string) {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { $functions } = useNuxtApp()

  /** 遷移を記録してから Google の口コミ画面を開く。記録は遷移を妨げないよう待たない（失敗しても回答者には見せない） */
  function openGoogle(responseId: string, reviewUrl: string): void {
    const record: Promise<unknown> = isMock
      ? mockLatency(100).then(() => postReviewRedirectFunc(db.value, responseId))
      : callFunction($functions, 'postReviewRedirect', { slug, submissionId: responseId })
    void record.catch(() => {})
    window.open(reviewUrl, '_blank', 'noopener')
  }

  return { openGoogle }
}
```

- [ ] **Step 3: 回答画面に読み込み中の表示を足す**

`app/pages/s/[slug]/index.vue`:

1. `UNAVAILABLE_MESSAGES` の定義の下に追加する:

```ts
/** 受け付けていないときの文言（読み込み中は使わない） */
const unavailableMessage = computed(() => {
  const key = availability.value
  return key === 'available' || key === 'loading' ? UNAVAILABLE_MESSAGES['not-found'] : UNAVAILABLE_MESSAGES[key]
})
```

2. テンプレートの先頭のブロック:

```vue
  <div v-if="availability !== 'available' || !snapshot" class="space-y-4 py-10 text-center">
    <p v-if="snapshot" class="text-sm text-slate-500">{{ snapshot.storeName }}</p>
    <UiCommonAlert tone="warning">{{ UNAVAILABLE_MESSAGES[availability === 'available' ? 'not-found' : availability] }}</UiCommonAlert>
  </div>
```

を、次の内容に置き換える:

```vue
  <div v-if="availability === 'loading'" class="py-10 text-center text-sm text-slate-500" role="status">
    読み込み中…
  </div>

  <div v-else-if="availability !== 'available' || !snapshot" class="space-y-4 py-10 text-center">
    <p v-if="snapshot" class="text-sm text-slate-500">{{ snapshot.storeName }}</p>
    <UiCommonAlert tone="warning">{{ unavailableMessage }}</UiCommonAlert>
  </div>
```

- 送信の処理（`onSubmit`）は変えない。`result.isEligible` なら `/s/[slug]/review`、そうでなければ `/s/[slug]/thanks` へ進む。

- [ ] **Step 4: 案内画面を置き換える**

`app/pages/s/[slug]/review.vue`:

```vue
<script setup lang="ts">
definePageMeta({ layout: 'survey' })
useSeoMeta({ title: '口コミのお願い', robots: 'noindex, nofollow' })

// F-13 Google 口コミへの案内。文面の生成・コピーは今回は作らず、Google の口コミ画面を開くボタンだけを置く

const route = useRoute()
const slug = String(route.params.slug)
const { snapshot, lastResult } = usePublicSurvey(slug)
const { openGoogle } = useReviewDraft(slug)

// 直接開かれた場合（回答していない・条件を満たしていない・口コミ URL が手元にない）は回答画面へ戻す
if (!lastResult.value?.isEligible || !lastResult.value.reviewUrl) {
  await navigateTo(`/s/${slug}`, { replace: true })
}

const isOpened = ref(false)

function onOpenGoogle(): void {
  const result = lastResult.value
  if (!result?.reviewUrl) return
  openGoogle(result.responseId, result.reviewUrl)
  isOpened.value = true
}
</script>

<template>
  <div class="space-y-5">
    <header class="space-y-2 text-center">
      <p class="text-sm font-medium text-brand-700">{{ snapshot?.storeName }}</p>
      <h1 class="text-xl font-bold text-slate-900">ご回答ありがとうございます</h1>
      <p class="text-sm leading-relaxed text-slate-600">
        よろしければ、Google マップに口コミを投稿していただけると励みになります。投稿は任意です。
      </p>
    </header>

    <UiCommonButton is-block icon="google" @click="onOpenGoogle">Google に口コミを書く</UiCommonButton>

    <section v-if="isOpened" class="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
      <p class="font-medium">開いた Google の画面で、次の手順で投稿してください。</p>
      <ol class="list-decimal space-y-1 pl-5">
        <li><strong>星の数</strong>を選ぶ</li>
        <li>ご感想を書く</li>
        <li>「<strong>投稿</strong>」をタップ</li>
      </ol>
      <p class="text-xs text-brand-700">Google の画面が開かない場合は、ポップアップのブロックを解除してもう一度お試しください。</p>
      <UiCommonButton :to="`/s/${slug}/thanks`" variant="secondary" is-block>完了</UiCommonButton>
    </section>

    <NuxtLink v-else :to="`/s/${slug}/thanks`" class="block text-center text-sm text-slate-500 hover:underline">
      投稿しない
    </NuxtLink>
  </div>
</template>
```

- [ ] **Step 5: 型チェックと画面の確認（モックモード）**

Run: `npm run typecheck`
Expected: エラーなし。

Run: `npm run dev` で確認する（Playwright を使う）。
- 管理画面の公開中のアンケートの公開管理画面から回答 URL を開く。
- 星 5 で送信する。
  - `/s/{slug}/review` に移り、「Google に口コミを書く」ボタンだけが出る（下書きの文面・「別の文面にする」・コピーの案内は出ない）。
  - ボタンを押すと `https://search.google.com/local/writereview?placeid=...` が新しいタブで開き、投稿手順と「完了」が出る。「完了」でお礼の画面に移る。
- もう一度回答 URL を開き、星 2 で送信すると、お礼の画面（ご意見は店舗に届きました）に直接移る。
- `/s/{slug}/review` を直接開くと、回答画面へ戻される（新しいタブで sessionStorage が空のとき）。
- 管理画面の回答一覧で、さっきの回答が出て、「Google 遷移率」が増えている。
- 存在しない slug（`/s/xxxxxxxxxx`）では「アンケートが見つかりません。URL をご確認ください。」が出る。
- コンソールにエラーが出ていない。

- [ ] **Step 6: 確認**

Run: `git status --short app/composables app/pages/s`
Expected: `usePublicSurvey.ts`・`useReviewDraft.ts`・`pages/s/[slug]/index.vue`・`review.vue` が変更として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 13: 編集画面（自動保存の本接続と、生成設定・テスト生成の非表示）

**Files:**
- Modify（全体を置き換え）: `app/composables/useSurveyEditor.ts`
- Modify: `app/pages/admin/[orgId]/surveys/[surveyId]/edit.vue`
- Modify: `app/components/SurveyEditor/Edit/QuestionList.vue:120-127`
- Delete: `app/components/SurveyEditor/Edit/DraftSettings.vue`（呼び出し名 `<SurveyEditorEditDraftSettings />`）

**Interfaces:**
- Consumes: Task 9 の `updateSurveyDraft`、Task 10 の `db.value.surveys`
- Produces:
  - `type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'`
  - `useSurveyEditor(surveyId)`：返り値 `{ survey, draft, title, saveState, saveError, isEditable, canAddQuestion, referencedQuestionIds, addQuestion, removeQuestion, duplicateQuestion, moveQuestion, addOption, removeOption, addCondition, changeConditionQuestion, removeCondition, save }`
    - `previewReviewDraft` は削除する（テスト生成を表示しないため）
    - `save(): Promise<void>`
  - `COMPARATOR_LABELS` / `COMPARATORS_BY_TYPE` / `SURVEY_EDITOR_KEY` / `useInjectedSurveyEditor` / `SurveyEditor` は維持する

- [ ] **Step 1: `useSurveyEditor` を置き換える**

`app/composables/useSurveyEditor.ts`:

```ts
import type { InjectionKey } from 'vue'
import type { Comparator, QuestionType, RedirectCondition, Survey, SurveyContent } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { errorMessageOf } from '~/utils/mock/functions/shared'
import { cloneData } from '~/utils/cloneData'
import { OPTION_LIMIT, QUESTION_LIMIT, createQuestion } from '~/utils/surveyTemplates'

// F-06・F-07 アンケートの下書き編集。
// 入力が止まってから一定時間後に自動保存する。本物モードは updateSurveyDraft（Functions）で保存する。
// 口コミ文面の生成設定（reviewDraftSettings）は画面に出さないが、値は下書きと一緒にそのまま保存する。

const AUTOSAVE_DELAY_MS = 800

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  eq: 'と等しい',
  neq: 'と等しくない',
  gte: '以上',
  lte: '以下',
  includes: 'を含む',
  notIncludes: 'を含まない',
  notEmpty: '回答がある',
}

/** 設問タイプごとに使える比較子 */
export const COMPARATORS_BY_TYPE: Record<QuestionType, Comparator[]> = {
  rating: ['gte', 'lte', 'eq', 'neq'],
  nps: ['gte', 'lte', 'eq', 'neq'],
  single: ['eq', 'neq'],
  multi: ['includes', 'notIncludes'],
  text: ['notEmpty'],
}

export function useSurveyEditor(surveyId: string) {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const survey = computed(() => db.value.surveys.find(item => item.id === surveyId) ?? null)

  const draft = ref<SurveyContent | null>(null)
  const title = ref('')
  const saveState = ref<SaveState>('saved')
  const saveError = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 読み込みで draft / title を入れた直後の変更通知は、自動保存しない */
  let isLoading = false
  /** 編集の回数。保存中に編集されたら、保存が終わっても「未保存」のままにする */
  let revision = 0

  function saveToMock(target: Survey, content: SurveyContent): void {
    target.draft = cloneData(content)
    target.title = title.value.trim() || target.title
    target.hasUnpublishedChanges = target.currentVersion !== null
    target.updatedAt = new Date().toISOString()
  }

  async function save(): Promise<void> {
    const target = survey.value
    if (!target || !draft.value) return
    if (isMock) {
      saveToMock(target, draft.value)
      saveState.value = 'saved'
      return
    }
    const savingRevision = revision
    saveState.value = 'saving'
    saveError.value = null
    try {
      await callFunction($functions, 'updateSurveyDraft', {
        orgId: target.orgId,
        surveyId,
        title: title.value.trim() || target.title,
        draft: cloneData(draft.value),
      })
      if (revision === savingRevision) saveState.value = 'saved'
    }
    catch (error) {
      // 次の編集で再び保存する
      saveState.value = 'error'
      saveError.value = errorMessageOf(error)
    }
  }

  watch([draft, title], () => {
    if (isLoading) {
      isLoading = false
      return
    }
    revision++
    saveState.value = 'unsaved'
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!isMock) {
        void save()
        return
      }
      saveState.value = 'saving'
      setTimeout(save, 200)
    }, AUTOSAVE_DELAY_MS)
  }, { deep: true })

  // 本物モードでは購読が届いてから下書きを読み込む（作成直後や再読み込み直後は、まだ届いていない）。
  // 一度読み込んだ後は、購読の更新で編集中の内容を上書きしない
  watch(survey, (value) => {
    if (!value || draft.value) return
    isLoading = true
    draft.value = cloneData(value.draft)
    title.value = value.title
  }, { immediate: true })

  onBeforeUnmount(() => {
    // 画面を離れるときは待たずに保存する
    if (saveState.value === 'unsaved' || saveState.value === 'error') void save()
    clearTimeout(timer)
  })

  const isEditable = computed(() => survey.value?.status !== 'closed')
  const canAddQuestion = computed(() => (draft.value?.questions.length ?? 0) < QUESTION_LIMIT)

  /** 遷移条件から参照されている設問 ID */
  const referencedQuestionIds = computed(() =>
    new Set(draft.value?.redirectRule.conditions.map(condition => condition.questionId) ?? []))

  function addQuestion(type: QuestionType): void {
    if (!draft.value || !canAddQuestion.value) return
    draft.value.questions.push(createQuestion(type))
  }

  function removeQuestion(questionId: string): void {
    if (!draft.value) return
    draft.value.questions = draft.value.questions.filter(question => question.id !== questionId)
    // 削除した設問を参照する条件も外す
    draft.value.redirectRule.conditions = draft.value.redirectRule.conditions.filter(condition => condition.questionId !== questionId)
  }

  function duplicateQuestion(questionId: string): void {
    if (!draft.value || !canAddQuestion.value) return
    const index = draft.value.questions.findIndex(question => question.id === questionId)
    const source = draft.value.questions[index]
    if (!source) return
    const copy = { ...cloneData(source), id: createQuestion(source.type).id }
    copy.options = copy.options.map(option => ({ ...option, id: `o-${crypto.randomUUID().slice(0, 8)}` }))
    draft.value.questions.splice(index + 1, 0, copy)
  }

  function moveQuestion(questionId: string, direction: -1 | 1): void {
    if (!draft.value) return
    const questions = draft.value.questions
    const index = questions.findIndex(question => question.id === questionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= questions.length) return
    ;[questions[index], questions[target]] = [questions[target]!, questions[index]!]
  }

  function addOption(questionId: string): void {
    const question = draft.value?.questions.find(item => item.id === questionId)
    if (!question || question.options.length >= OPTION_LIMIT) return
    question.options.push({ id: `o-${crypto.randomUUID().slice(0, 8)}`, label: `選択肢 ${question.options.length + 1}` })
  }

  function removeOption(questionId: string, optionId: string): void {
    const question = draft.value?.questions.find(item => item.id === questionId)
    if (!question || question.options.length <= 2) return
    question.options = question.options.filter(option => option.id !== optionId)
  }

  function defaultConditionFor(questionId: string): RedirectCondition {
    const question = draft.value?.questions.find(item => item.id === questionId)
    const comparator = COMPARATORS_BY_TYPE[question?.type ?? 'rating'][0]!
    const value = question?.type === 'rating' ? 4 : question?.type === 'nps' ? 9 : question?.options[0]?.id ?? null
    return { id: `c-${crypto.randomUUID().slice(0, 8)}`, questionId, comparator, value: comparator === 'notEmpty' ? null : value }
  }

  function addCondition(): void {
    const first = draft.value?.questions[0]
    if (!draft.value || !first) return
    draft.value.redirectRule.conditions.push(defaultConditionFor(first.id))
  }

  /** 条件の設問を変えたら、比較子と値をその設問タイプの既定値に戻す */
  function changeConditionQuestion(conditionId: string, questionId: string): void {
    const conditions = draft.value?.redirectRule.conditions
    const index = conditions?.findIndex(condition => condition.id === conditionId) ?? -1
    if (!conditions || index < 0) return
    conditions.splice(index, 1, { ...defaultConditionFor(questionId), id: conditionId })
  }

  function removeCondition(conditionId: string): void {
    if (!draft.value) return
    draft.value.redirectRule.conditions = draft.value.redirectRule.conditions.filter(condition => condition.id !== conditionId)
  }

  return {
    survey,
    draft,
    title,
    saveState,
    saveError,
    isEditable,
    canAddQuestion,
    referencedQuestionIds,
    addQuestion,
    removeQuestion,
    duplicateQuestion,
    moveQuestion,
    addOption,
    removeOption,
    addCondition,
    changeConditionQuestion,
    removeCondition,
    save,
  }
}

export type SurveyEditor = ReturnType<typeof useSurveyEditor>

/** 編集画面の子コンポーネントへ編集状態を渡すためのキー */
export const SURVEY_EDITOR_KEY: InjectionKey<SurveyEditor> = Symbol('survey-editor')

/** 編集画面の子コンポーネントから編集状態を取り出す */
export function useInjectedSurveyEditor(): SurveyEditor {
  const editor = inject(SURVEY_EDITOR_KEY)
  if (!editor) throw new Error('SurveyEditor が provide されていません')
  return editor
}
```

- 自動保存の監視（`watch([draft, title])`）を、読み込み（`watch(survey, ..., { immediate: true })`）より**先に**登録する。こうすると、モックモード（読み込みがセットアップ中に同期で起きる）でも本物モード（購読が届いてから起きる）でも、読み込みによる変更通知が必ず 1 回だけ届き、`isLoading` で読み飛ばせる。順番を逆にすると、モックモードで最初の編集が保存されない。

- [ ] **Step 2: 編集画面から生成設定のタブを外し、保存の失敗を表示する**

`app/pages/admin/[orgId]/surveys/[surveyId]/edit.vue`:

1. スクリプト冒頭のコメントと型:

```ts
// F-06〜F-08 アンケート編集（設問 / 遷移条件 / 口コミ生成 / デザイン）

type EditorTab = 'questions' | 'rule' | 'draft' | 'design'
```

を、次の内容に置き換える:

```ts
// F-06・F-07 アンケート編集（設問 / 遷移条件 / デザイン）。
// 口コミ文面の生成設定とテスト生成は、文面の生成を作らないため表示しない（値は保存時にそのまま残る）

type EditorTab = 'questions' | 'rule' | 'design'
```

2. `const { draft, title, saveState, isEditable } = editor` を `const { draft, title, saveState, saveError, isEditable } = editor` に変える。
3. `TABS` から `{ value: 'draft', label: '口コミ生成' },` の行を削除する。
4. `const SAVE_STATE_LABELS = { saved: '保存済み', unsaved: '未保存の変更あり', saving: '保存中…' } as const` を次に置き換える:

```ts
const SAVE_STATE_LABELS = { saved: '保存済み', unsaved: '未保存の変更あり', saving: '保存中…', error: '保存に失敗しました' } as const
```

5. 保存状態の表示 `:class="saveState === 'saved' ? 'text-emerald-700' : 'text-slate-500'"` を次に置き換える:

```vue
          :class="saveState === 'saved' ? 'text-emerald-700' : saveState === 'error' ? 'text-rose-700' : 'text-slate-500'"
```

6. `<UiCommonAlert v-if="!isEditable" tone="info" title="終了したアンケートです">` の直前に追加する:

```vue
    <UiCommonAlert v-if="saveState === 'error' && saveError" tone="danger" title="保存に失敗しました">
      {{ saveError }} 次に編集したときに、もう一度保存します。
    </UiCommonAlert>
```

7. タブの中身から `<SurveyEditorEditDraftSettings v-else-if="activeTab === 'draft'" />` の行を削除する。

- [ ] **Step 3: 設問の「口コミ下書きの材料に使う」を表示しない**

`app/components/SurveyEditor/Edit/QuestionList.vue` の次のブロック:

```vue
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <UiInputCheckboxField v-model="question.isRequired" label="必須にする" />
        <UiInputCheckboxField
          v-model="question.useForReviewDraft"
          label="口コミ下書きの材料に使う"
          description="オンにすると、この設問の回答を下書き生成に使います"
        />
      </div>
```

を、次の内容に置き換える:

```vue
      <!-- 口コミ下書きの材料（useForReviewDraft）は文面の生成を作らないため表示しない。値は保存時にそのまま残る -->
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <UiInputCheckboxField v-model="question.isRequired" label="必須にする" />
      </div>
```

- [ ] **Step 4: 生成設定の部品を削除する**

Run: `rm app/components/SurveyEditor/Edit/DraftSettings.vue`

Run: `grep -rn "SurveyEditorEditDraftSettings\|previewReviewDraft\|DraftSettings" app`
Expected: 何も出ない。

Run: `grep -rn "SaveState" app`
Expected: `app/composables/useSurveyEditor.ts` だけに出る。

- [ ] **Step 5: 型チェックと画面の確認（モックモード）**

Run: `npm run typecheck`
Expected: エラーなし。

Run: `npm run dev` で、モックの owner のアカウントで確認する（Playwright を使う）。
- 下書きのアンケートの編集画面を開く。
  - タブは「設問」「遷移条件」「デザイン」の 3 つ。
  - 設問に「口コミ下書きの材料に使う」のチェックが出ない。
- タイトルを変える。「未保存の変更あり」→「保存中…」→「保存済み」と変わる。
- 一覧に戻り、タイトルが変わっている。
- 開いた直後（何も編集していない状態）は「保存済み」のまま。
- 公開済みのアンケートで設問文を変えると、公開管理画面で「未公開の変更あり」になる。
- コンソールに `Failed to resolve component` が出ていない。

- [ ] **Step 6: 確認**

Run: `git status --short app`
Expected: `useSurveyEditor.ts`・`edit.vue`・`QuestionList.vue` の変更と、`DraftSettings.vue` の削除が表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 14: 本接続の範囲・通し確認・ドキュメント

**Files:**
- Modify: `app/composables/useAdminNav.ts:29`
- Modify: `.claude/PROJECT.md`（モード・Functions・Firestore・秘密情報の節）
- Modify: `docs/02-database.md`、`docs/04-features.md`、`docs/05-open-issues.md`
- Modify: `docs/superpowers/specs/2026-10-08-surveys-integration-design.md`（状態を「実装済み」に）

- [ ] **Step 1: 本物モードでアンケートの画面を開けるようにする**

`app/composables/useAdminNav.ts:29` を、次の内容に置き換える:

```ts
const FIREBASE_READY_PATHS = ['/settings/organization', '/settings/members', '/settings/google', '/stores', '/profiles', '/reviews', '/posts', '/rankings', '/surveys']
```

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 2: Emulator で本物モードを通して確認する**

Run: `npm run dev:emulator`（Emulator UI は http://127.0.0.1:4000 ）

Playwright（`browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_tabs` / `browser_console_messages`）で確認する。

準備:
- owner のアカウントでログインし、組織を開く。
- 店舗が無ければ、Emulator UI の Firestore で `organizations/{orgId}/stores/st-test` を作る。
  - フィールド：`orgId`（組織 ID）、`name: "テスト店"`、`status: "active"`、`reviewUrl: "https://search.google.com/local/writereview?placeid=test"`

確認すること:
1. **作成（Review Focus 1）**：`/surveys/new` で作成する。
   - 「アンケートが見つかりません」を出さずに編集画面が開く。
   - 開いた直後は「保存済み」のまま。
2. **下書きの保存**：タイトルを変えて「保存済み」になる。Emulator UI で `surveys/{id}.title` と `draft` が変わっている。
3. **公開**：公開管理で「公開」する。
   - Emulator UI で `surveyVersions/{id}_1`（`storeId` 付き）ができている。
   - `publicSurveys/{slug}` ができ、`redirectRule`・`reviewDraftSettings`・`reviewUrl` を含まない。
4. **複製（Review Focus 1）**：一覧の「複製」で、複製したアンケートの編集画面がそのまま開く。
5. **回答（未ログイン）**：`browser_tabs` で新しいタブを開き、ログアウトした状態（別のブラウザコンテキスト、またはログアウト後）で回答 URL を開く。
   - 星 5 で送信すると「Google に口コミを書く」だけの案内画面になる。
   - 押すと `reviewUrl` が新しいタブで開く。「完了」でお礼の画面に移る。
   - 星 2 で送信すると、お礼の画面に直接移る。
6. **レート制限**：同じ回答 URL で続けて送信する（お礼の画面から回答 URL に戻って送り直す）。
   - 同じ 10 分の間の 6 件目で「短時間に多くの回答が送られました。しばらくしてから再度お試しください。」が出る。
   - Emulator UI で `rateLimits/{slug}_{ipHash}.hits` が 5 件。
7. **停止・再開**：公開管理で「一時停止」すると、回答 URL を開き直したときに「現在このアンケートは受け付けていません。」が出る。「再開」で元に戻る。
8. **回答一覧と CSV**：回答一覧の画面を開く。
   - 「直近 90 日・最大 2,000 件を表示しています。それより前は CSV で確認してください」が出る。
   - 回答数・条件合致率・Google 遷移率が、送った回答と合っている。
   - CSV をダウンロードし、`口コミ下書き` の列が無く、`Google 遷移日時` が入っている。
9. **使用回数**：Emulator UI で `usageMonthly/{YYYYMM}.responses` が受け付けた件数と同じ。
10. **店舗のアーカイブ**：店舗の詳細で「アーカイブ」する。
    - アンケートが「終了」になり、`publicSurveys/{slug}` が消える。
    - 回答 URL は「アンケートが見つかりません。URL をご確認ください。」になる。
11. **staff**：staff のアカウント（担当店舗あり）でログインし、担当店舗のアンケートと回答だけが一覧に出る（コンソールに `permission-denied` が出ない）。
12. ここまでで、コンソールに `Failed to resolve component` やエラーが出ていない。

問題が見つかったら、原因・理由・修正案を記録してユーザーに伝える（このステップでは実装を変えない）。

- [ ] **Step 3: モックモードの既存動作を確認する**

Run: `npm run dev`
- アンケートの一覧・作成・編集・公開管理・回答一覧・CSV、回答画面と案内画面が、Task 11〜13 の確認と同じように動く。
- 店舗の詳細で「アーカイブ」すると、モックのとおり公開中のアンケートが「一時停止」になる（モックは変更していない）。

- [ ] **Step 4: PROJECT.md に追記する**

`.claude/PROJECT.md`:

1. 「モード（モック / 本接続）」の箇条書きの末尾に追加する:

```markdown
- アンケートの回答の表示は新しい順に直近 90 日・最大 2,000 件（`useFirestoreSync` の `RESPONSE_DAYS` / `RESPONSE_LIMIT`）。それより前は CSV（`getResponsesCsv`、最大 5,000 件）で確認する
- 回答画面（`/s/[slug]`）は未ログインで `publicSurveys/{slug}` を 1 回だけ読む（購読しない）
```

2. 「Functions」の表の `フォルダ` の行の末尾に、`、`surveys/`（アンケートの管理・公開・CSV）、`responses/`（回答の受付・遷移ルールの判定・レート制限。ログイン不要）` を加える。
3. 「### 順位計測（rankings/）」の節の後ろ（「### Functions の環境変数」の前）に追加する:

```markdown
### アンケート（surveys/・responses/）

- 管理側（作成・複製・下書き・公開・状態・slug・期間・CSV）はログイン必須の callable。権限は「組織のメンバー。staff は担当店舗のみ」
- 公開・状態の変更・slug の再発行・期間の変更は、1 つのトランザクションで `surveys`・`surveyVersions`・`publicSurveys` をそろえる（`surveys/publicSurvey.ts` の `writePublicSurvey`）
- 回答（`postSurveyResponse`）と遷移の記録（`postReviewRedirect`）はログイン不要（`publicCallable`）。遷移ルールの判定はサーバーだけで行う
- 同じ接続元から同じアンケートへの回答は 10 分で 5 件まで（`rateLimits/{slug}_{ipHash}`）。接続元は `request.rawRequest.ip` を `IP_HASH_SALT` 付きでハッシュしたもの
- 本番デプロイ後に、`rateLimits` のドキュメント ID が回答者ごとに分かれていることを確認する（全員が同じ ID なら、`rawRequest.ip` がプロキシの IP になっている）
- App Check は未導入。本番で公開する前に追加する（`docs/05-open-issues.md`）
- 口コミ文面の生成（LLM）は未実装。案内画面は「Google に口コミを書く」ボタンだけ。編集画面の生成設定とテスト生成は表示しない
- 店舗をアーカイブすると、その店舗の公開中・停止中のアンケートは終了する（モックは一時停止のまま）
```

4. 「Functions の環境変数」の表に行を追加する:

```markdown
| `IP_HASH_SALT` | 回答者の IP をハッシュするソルト（秘密。コミットしない）。本番で未設定だと回答を受け付けない。Emulator では未設定なら固定値 | `openssl rand -hex 32` で作った値 |
```

5. 「Firestore」の表に行を追加する:

```markdown
| アンケート | `surveys/{id}`・`surveyVersions/{surveyId}_{n}`（組織直下。`storeId` 付き）・`responses/{submissionId}`（直近 90 日を購読。`ipHash` はサーバーだけが使う）・`usageMonthly/{YYYYMM}.responses`。トップレベルの `publicSurveys/{slug}`（誰でも読める）と `rateLimits/{slug}_{ipHash}`（全員拒否） |
```

6. 「Firestore」の表の `インデックス` の行に、`responses (storeId, createdAt DESC)`・`responses (surveyId, createdAt DESC)`・`responses (surveyId, storeId, createdAt DESC)` を追記する。
7. 「秘密情報」の節の 1 行目の末尾に、`Functions の環境変数 `IP_HASH_SALT` もコミットしない。` を加える。

- [ ] **Step 5: 設計資料を更新する**

- `docs/02-database.md`
  - 3.9 `surveys`：下書きはクライアントから直接書かず、`updateSurveyDraft`（Functions）で保存する、と書く。
  - 3.10：パスを `organizations/{orgId}/surveyVersions/{surveyId}_{n}` に変え、`storeId` を加える。理由（staff の絞り込みを `storeId in` の購読で扱うため）を書く。
  - 3.11 `publicSurveys`：一時停止中も `status: 'paused'` で残り、終了・店舗のアーカイブで削除される、と書く。
  - 3.12 `responses`：`ipHash`（`SHA-256(IP_HASH_SALT + ':' + ip)`）を加え、`reviewDraft` は常に `null` と書く。
  - `rateLimits/{slug}_{ipHash}`（`{ hits: Timestamp[] }`、全員拒否）の節を追加する。
  - 3.15 `usageMonthly`：`responses` を回答の受付時に加算する、と書く。
  - 5 章のルールを、仕様書 4.1 のとおりに直す。
- `docs/04-features.md`
  - F-08：生成設定とテスト生成は今回は作らず、編集画面に表示しない。
  - F-09：店舗をアーカイブすると公開中・停止中のアンケートは終了する。
  - F-10：同じ接続元から 10 分で 5 件までのレート制限。App Check は本番公開の前に追加する。
  - F-11：遷移ルールの判定はサーバー（`postSurveyResponse`）だけで行う。
  - F-12：今回は作らない。
  - F-13：案内画面は「Google に口コミを書く」ボタンだけ。
  - F-14：一覧は直近 90 日・最大 2,000 件、CSV は最大 5,000 件、文面の列は出さない。
- `docs/05-open-issues.md`
  - I-01 と I-08 の末尾に「2026-10-08: 遷移ルールはリスクを承知で実装（docs/superpowers/specs/2026-10-08-surveys-integration-design.md）」を加える。
  - I-06 の末尾に「2026-10-08: 文面生成は今回作らない」を加える。
- 仕様書 `docs/superpowers/specs/2026-10-08-surveys-integration-design.md` の `状態: レビュー待ち` を `状態: 実装済み` にする。

- [ ] **Step 6: 最終確認**

Run:
```bash
npm --prefix functions run build && npm --prefix functions test && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator && npm run typecheck && npm run build
```
Expected: すべて成功する。`npm run build` は Nuxt の本番ビルドで、警告に `Failed to resolve component` が出ない。

Run: `git status --short`
Expected: 計画の「ファイル構成」にあるファイルと、ドキュメントの更新だけが差分になっている。コミットはユーザーの許可がある場合のみ行う。
