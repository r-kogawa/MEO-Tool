# 新規登録の追加項目と登録経路の記録 設計書

- 作成日: 2026-10-20
- 状態: 実装済み（2026-10-20。本番での通し確認とリリースは未実施）
- 関連: `docs/04-features.md` F-01 / F-20、`docs/02-database.md`、`docs/03-pages.md`（`/signup`・運営画面）、`docs/superpowers/specs/2026-10-18-ops-console-design.md`
- 参考: 申し込みフォーム https://mff-fc.inceptoaxis.com/meo（「無料アカウントのお申し込み」）

## 0. 目的と範囲

### 目的

新規登録時に「電話番号」「業種」「運営店舗数」を必須で受け取り、あわせて「どのリンク（名刺・広告）から来たか」を記録する。運営者が運営画面で、組織ごとにこれらを確認できるようにする。

### 決定事項（ヒアリング結果）

| 項目 | 決定 |
| --- | --- |
| 追加する入力 | 電話番号・業種・運営店舗数。**3 つとも必須** |
| 選択肢 | 参考ページと同じ。運営店舗数「1店舗 / 2店舗 / 3〜5店舗 / 6店舗以上」、業種「サロン / 整体・整骨院 / 美容 / 無人店舗 / その他」 |
| 登録日時 | 既存の `organizations.createdAt` / `users.createdAt`（`createOrganization` が `serverTimestamp` で保存済み）を**そのまま使う**。新しく足さない |
| 外部 API | `createAccount` も同じ 3 項目を**必須**にする。**すでに本番で外部システムから呼ばれている**ため、呼び出し側の改修を先に行う（7 章） |
| プライバシーポリシー | 今回の範囲で改定する。文案は Claude が作り、ユーザーが確認する（9 章） |
| 電話番号・経路の利用目的 | サポート・事務連絡、営業・サービス案内、広告・名刺の効果測定、サービス改善の分析（4 つすべて） |
| 登録経路の渡し方 | 名刺・広告に載せるリンクのクエリパラメーター |
| リンクの着地先 | **LP（`/`）に着地**し、そこから「アカウント登録」（`/signup`）へ進む |
| 確認する場所 | 運営画面（`/ops/organizations` と `/ops/organizations/[orgId]`） |

### 範囲外

- 管理画面（顧客側）での追加項目の表示・編集
- 運営画面での追加項目の編集（表示のみ）
- 経路ごとの集計画面・CSV 出力
- 参考ページにある任意項目（店舗名・店舗 URL・相談内容）とハニーポット
- 既存組織への値の後入れ（既存組織は「登録情報なし」と表示する）

## 1. 入力項目

| 項目 | 入力形式 | 値（保存値 → 表示ラベル） | 検証 |
| --- | --- | --- | --- |
| 電話番号 `phone` | テキスト（`type="tel"`、`autocomplete="tel"`） | 数字だけの文字列 | 2 章の正規化のあと `^0\d{9,10}$`（0 始まり 10〜11 桁） |
| 運営店舗数 `storeCount` | ラジオ 4 択 | `'1'` 1店舗 / `'2'` 2店舗 / `'3-5'` 3〜5店舗 / `'6+'` 6店舗以上 | いずれか |
| 業種 `industry` | プルダウン（初期表示「選択してください」） | `'salon'` サロン / `'bodywork'` 整体・整骨院 / `'beauty'` 美容 / `'unmanned'` 無人店舗 / `'other'` その他 | いずれか |

### 電話番号の正規化（画面と Functions で同じ規則）

1. `normalize('NFKC')`（全角数字・全角ハイフンを半角に）
2. 空白・括弧・各種ハイフン（`-` `‐` `‑` `–` `—` `―` `−` `ー`）を取り除く
3. `^0\d{9,10}$` に合わなければ「電話番号の形式が正しくありません。」
4. 保存は数字だけ（例: `09012345678`）

## 2. 登録経路の取得と引き継ぎ（画面）

### 読み取るパラメーター

| クエリ | 保存名 | 想定 |
| --- | --- | --- |
| `utm_source` | `utmSource` | 広告（媒体名） |
| `utm_medium` | `utmMedium` | 広告（種類） |
| `utm_campaign` | `utmCampaign` | 広告（キャンペーン名） |
| `ref` | `ref` | 名刺など。短い任意の値（例: `?ref=card-tanaka`） |

### 引き継ぎの規則

- アプリの起動時（どのページで開かれても）に `window.location.search` を読み、上の 4 つのうち 1 つでも空でない値があれば、ブラウザの localStorage `meo-tool:signup-source` に保存する
  - 保存する内容: 4 つの値（無いものは `null`）、`landingPath`（開いたページのパス。クエリは含めない）、`capturedAt`（保存日時、ISO 文字列）
  - 各値は 100 文字で切り詰める（`landingPath` は 200 文字）
- **後勝ち**: すでに保存があっても、新しいパラメーター付きで開かれたら上書きする
- **有効期限 30 日**: 読むときに `capturedAt` から 30 日を過ぎていれば無いものとして扱い、削除する
- パラメーターが無いページを開いても、保存済みの値は消さない（LP → `/signup` の遷移で失われないように）
- 登録が成功したら（組織作成まで終わったら）削除する
- localStorage が使えない環境（プライベートモード等）では例外を握りつぶし、経路なしとして登録を続ける。**経路の不具合で登録を止めない**

### 置き場所

- `app/composables/useSignupSource.ts`: `capture()`（URL から保存）・`load()`（期限内の値を返す。無ければ `null`）・`clear()`
- `app/plugins/signup-source.client.ts`: 起動時に `capture()` を 1 回呼ぶ。`auth.global.ts` などのリダイレクトより前に URL を読むため plugin で行う

## 3. 保存（Firestore）

### `signupProfiles/{orgId}`（トップレベル・**ルールで全拒否**）

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| orgId | string | ○ | |
| ownerUid | string | ○ | 登録したユーザー |
| phone | string | ○ | 数字だけ |
| industry | `'salon' \| 'bodywork' \| 'beauty' \| 'unmanned' \| 'other'` | ○ | |
| storeCount | `'1' \| '2' \| '3-5' \| '6+'` | ○ | |
| via | `'signup' \| 'externalApi'` | ○ | 登録方法。画面の新規登録か、外部 API（`createAccount`）か |
| source | map \| null | ○ | `{ utmSource, utmMedium, utmCampaign, ref, landingPath, capturedAt }`（各 string \| null）。経路なしは `null` |
| createdAt | timestamp | ○ | `serverTimestamp` |

- **組織ドキュメントに載せない理由**: `organizations/{orgId}` は組織のメンバー全員が読めるため、電話番号や「どの広告から来たか」がお客様側のスタッフにも見えてしまう。運営画面は Admin SDK の callable で読むので、ルールで全拒否のコレクションで足りる
- `firestore.rules` は「未記載のコレクションは全拒否」のため変更不要。ルールのテストで拒否を確かめる（8 章）
- 書き込みは `createOrganization` の**同じトランザクション**で `tx.create`。組織がすでにある再送は既存の早期 return に乗るので重複しない

## 4. Functions

### `functions/src/identity/signupProfile.ts`（新規）

- 型: `Industry`・`StoreCount`・`SignupVia`・`SignupSource`・`SignupProfileInput`（`phone` `industry` `storeCount` `source`）
- `parseSignupProfileInput(input: Record<string, unknown>): SignupProfileInput`
  - `phone`: `requirePhone`（下記）、`industry` / `storeCount`: 既存の `requireOneOf`
  - `source`: 省略・`null` → `null`。オブジェクトなら各キーを「省略・`null`・空文字 → `null`、文字列なら trim して上限以内、それ以外の型は `invalid-argument`」。全部 `null` なら `source` 自体を `null`
  - 上限: `utmSource` `utmMedium` `utmCampaign` `ref` は 100 文字、`landingPath` は 200 文字、`capturedAt` は 40 文字（中身の日付検証はしない。参考情報）
- `signupProfileRef(db, orgId)`

### `functions/src/shared/validation.ts`

- `requirePhone(value: unknown): string` を追加（1 章の正規化と検証。ラベルは「電話番号」）

### `functions/src/identity/createOrganization.ts`

- `CreateOrganizationInput` に `profile: SignupProfileInput` と `via: SignupVia` を加える
- `parseCreateOrganizationInput` で `profile` を読む（`via` は読まない。呼び出し元が決める）
- `createOrganizationFunc` は `via: 'signup'`、`createAccountFunc` は `via: 'externalApi'` を渡す
- トランザクション内で `tx.create(signupProfileRef(db, orgId), {...})`

### `functions/src/ops/organizations.ts`

- `OpsOrganizationSummary` に `signup: OpsSignupProfile | null` を加える（`OpsSignupProfile` は 3 章の `orgId` `ownerUid` `createdAt` を除いた形）
- `summarize` で `signupProfiles/{orgId}` を一緒に読む（一覧・詳細の両方に載る）

## 5. 新規登録画面（`app/pages/signup.vue`）

### 並び順

ご利用の形態 → 屋号 / 法人名 → お名前 → メールアドレス → パスワード → **電話番号** → **運営店舗数** → **業種** → 規約同意

### 実装

- 状態: `phone = ref('')`、`storeCount = ref<StoreCount | null>(null)`、`industry = ref<Industry | null>(null)`
- `canSubmit` に「`phone` が空でない」「`storeCount` と `industry` が `null` でない」を加える
- 運営店舗数は、既存の「ご利用の形態」と同じ見た目のカード型ラジオ（4 つ。スマホ 2 列・`sm` 以上 4 列、説明文なし）を `fieldset` でページ内に置く
- 業種は `UiInputSelectField`。先頭に `{ value: null, label: '選択してください', isDisabled: true }`
- 選択肢の値とラベルは `app/utils/signupProfile.ts`（新規）に置き、運営画面と共有する: `STORE_COUNT_LABELS`・`INDUSTRY_LABELS`・`SIGNUP_VIA_LABELS`・`normalizePhone`・`isValidPhone`。型は `app/types/domain.ts` に `Industry`・`StoreCount`・`SignupVia`・`SignupSource`・`SignupProfile`
- **電話番号は Auth ユーザーを作る前に画面側でも検証する**（`useAuth.signup` の先頭で `isValidPhone`。NG なら `MockFunctionsError('invalid-argument', '電話番号の形式が正しくありません。')`）。サーバーだけで弾くと、Auth ユーザーだけ作られてから組織作成で失敗するため

### 共通部品の小さな変更

- `UiInputTextField`: `type` に `'tel'` を加える
- `UiInputSelectField`: `isRequired` を加える（`TextField` と同じ「必須」バッジと `required` 属性）

### `app/composables/useAuth.ts`

- `SignupInput` に `phone` `industry` `storeCount` を加える
- `createOrganization` の呼び出しに `phone`（正規化済み）・`industry`・`storeCount`・`source: useSignupSource().load()` を加える
- 組織作成が成功したら `useSignupSource().clear()`

## 6. 運営画面

### 組織一覧（`/ops/organizations`）

- 列「登録経路」を「Google 連携」の前に足す。表示は `signup.source.ref ?? signup.source.utmSource`、無ければ `—`。`via === 'externalApi'` なら値の下に小さく「外部 API」
- 検索欄の対象に `ref` / `utmSource` / `utmMedium` / `utmCampaign` を加え、ラベルを「組織名・オーナーのメール・登録経路で検索」にする
- 空行の `colspan` を 8 にする

### 組織詳細（`/ops/organizations/[orgId]`）

- 「利用状態」カードの次に「登録情報」カードを足す。`dl` で以下を並べる
  - 電話番号、業種、運営店舗数、登録方法（`SIGNUP_VIA_LABELS`: 新規登録画面 / 外部 API）
  - 登録経路: `ref`、`utm_source`、`utm_medium`、`utm_campaign`、最初に開いたページ、経路の保存日時（無い値は `—`）
- `signup` が `null` の組織は「登録情報はありません（この項目を追加する前に登録された組織です）。」

### `app/composables/useOps.ts`

- `OpsOrganizationSummary` に `signup: SignupProfile | null`（Functions 側と同じ形）
- 仮データ側の `mockSummary` は `signup: null` を返す

## 7. 外部 API（`createAccount`）の互換性とリリース手順

### 入力の追加

既存の JSON に以下を加える。

```json
{
  "phone": "090-1234-5678",
  "industry": "salon",
  "storeCount": "3-5",
  "source": { "utmSource": "google", "utmMedium": "cpc", "utmCampaign": "meo-2026", "ref": null }
}
```

- `phone` `industry` `storeCount` は**必須**。無いと `400 invalid-argument`
- `source` は任意（キー名は画面と同じ。`landingPath` `capturedAt` も渡せる）

### リリース手順

`createAccount` はすでに本番で外部システムから呼ばれている。今の `parseCreateOrganizationInput` は知らないキーを無視するため、新しい項目を**先に送り始めても**今の本番は壊れない。

1. 外部システム側に、上記 3 項目（と任意で `source`）を送るよう先に改修してもらい、**本番で送られていることを確認する**（それまで 2・3 に進まない）
2. Hosting（画面とプライバシーポリシー）をデプロイする。新しい画面は追加項目を送るが、今の Functions は無視するので登録は通る
3. **間を空けずに** Functions をデプロイする（ここから必須になり、`signupProfiles` が作られる）

- 手順 2 の前に、`app/utils/privacy.ts` の `PRIVACY_REVISED_ON` を Hosting のデプロイ日に置き換える
- 2 と 3 の間に画面から登録した組織は `signupProfiles` が作られず、登録成功で localStorage の経路も消える。そのため 2 と 3 は続けて行う
- 逆順（Functions が先）だと、キャッシュされた古い画面と未改修の外部システムからの登録がすべて失敗する
- 外部システムへの改修依頼と完了の確認はユーザー側で行う（実装の範囲外）。依頼には上記の入力例と、選択肢の値（1 章）を渡す。あわせて次も伝える
  - 電話番号の規則（1 章）: 0 始まりの 10〜11 桁。区切り文字は使ってよい
  - `source` の仕様: オブジェクト。値は文字列か null。キーは camelCase の `utmSource` `utmMedium` `utmCampaign` `ref` `landingPath` `capturedAt`。上限は順に 100 / 100 / 100 / 100 / 200 / 40 文字。上限超えと文字列以外は `400 invalid-argument`。`utm_source` のような snake_case のキーは黙って無視される
  - 手順 3 のあと、旧形式（3 項目なし）で再送待ちのまま残っているリクエストは `400` になる
- リリースは利用の少ない時間帯に行う。古い画面を開いたままのタブは、手順 3 のあと 1 回だけ登録に失敗する（再読み込みで直る）

## 8. テスト

| 種類 | ファイル | 観点 |
| --- | --- | --- |
| 単体 | `functions/src/shared/__tests__/validation.test.ts` | `requirePhone`: ハイフンあり / 全角 / 括弧 / 9 桁・12 桁 / 0 始まりでない / 空 / 文字列以外 |
| 単体 | `functions/src/identity/__tests__/signupProfile.test.ts`（新規） | `parseSignupProfileInput`: 正常 / 選択肢外 / `source` 省略・`null`・全部空 → `null` / 上限超え / 文字列以外の値 |
| 結合 | `functions/src/identity/__tests__/createOrganization.itest.ts` | `signupProfiles/{orgId}` が `via: 'signup'` で作られる / 必須欠落は `invalid-argument` で組織も作られない / 再送で重複しない（既存テストの `input` に 3 項目を足す） |
| 結合 | `functions/src/identity/__tests__/createAccount.itest.ts` | `via: 'externalApi'` / 3 項目の欠落は `invalid-argument` |
| 結合 | `functions/src/ops/__tests__/organizations.itest.ts` | 一覧・詳細に `signup` が載る / プロフィールの無い組織は `null` |
| ルール | `functions/src/__tests__/firestore.rules.itest.ts` | 組織の owner でも `signupProfiles/{orgId}` を読めない |
| 型 | `npm run typecheck`、`npm --prefix functions run build` | |
| 画面（手動） | `npm run dev` + `npm --prefix functions run serve` | `/?ref=card-test` で開く → 「アカウント登録」→ 登録 → 運営画面の一覧・詳細に `card-test` が出る / 登録後に localStorage から消える / パラメーターなしで登録すると経路 `—` / 電話番号の形式エラーで Auth ユーザーが作られない / `/privacy` に追記した文面と「改定」日が出る |

## 9. プライバシーポリシーの改定（`app/utils/privacy.ts`）

電話番号・業種・運営店舗数・登録経路を取得し、localStorage に経路を保存するため、「取得する情報」「利用目的」「Cookie 等の利用」を改定する。**以下は文案。ユーザーの確認を経て確定する**（法的な文面のため、実装者は文案を変えない）。

### 取得する情報

- 1 項目目を次に置き換える（下線部が追加）
  > 利用登録・招待の受諾時に入力される情報（お名前、メールアドレス、法人名または屋号、パスワード、**および利用登録時の電話番号・業種・運営店舗数**）。パスワードは認証基盤で復元できない形式に変換して管理され、運営者がその内容を知ることはありません。
- 1 項目目の次に追加する
  > 利用登録に至った経路に関する情報（本サービスへのリンクに付与された広告・名刺等の識別子、最初に開いたページおよびその日時）

### 利用目的

- 「お問い合わせへの対応および本人確認のため」の次に追加する
  > 本サービスの導入・利用に関するご案内その他の事務連絡を、電話等により行うため
  >
  > 本サービスの新機能・料金プランその他運営者が提供するサービスのご案内を、電話等により行うため
  >
  > 広告・名刺等による案内の効果を測定するため
- 「障害の調査、本サービスの改善および新機能の開発のため」を次に置き換える（下線部が追加）
  > 障害の調査、**利用者の業種・店舗数等の傾向の分析、**本サービスの改善および新機能の開発のため
- 一覧の後ろ（「利用目的を変更する場合、…」の前）に追加する
  > 運営者からのサービスのご案内の連絡を希望されない場合は、本ポリシーの「お問い合わせ窓口」に記載の連絡先までお申し出ください。以後のご案内を停止します。

  （条番号は `LegalDocument` が配列の順で自動で振るため、本文に「第 12 条」のような番号は書かない）

### Cookie 等の利用

- 1 文目を次に置き換える（下線部が追加）
  > 本サービスは、ログイン状態の保持**、本サービスに至った経路の記録**等のため、ブラウザのローカルストレージ等の仕組み（以下「Cookie 等」といいます）を利用して、端末に情報を保存します。
- 1 文目の次に追加する
  > 本サービスへのリンクに広告・名刺等の識別子が付与されている場合、利用登録時に経路として記録するため、その識別子を最長 30 日間端末に保存します。利用登録が完了したときは、端末から削除します。

### 改定日の表示

- 今の表示は `LegalDocument` の「{日付} 制定」だけのため、`app/utils/privacy.ts` に `PRIVACY_REVISED_ON`（実装日。例 `'2026年10月21日'`）を足し、`LegalDocument.vue` に任意の `revisedOn` prop を足して「{制定日} 制定 / {改定日} 改定」と出す。`PRIVACY_ENACTED_ON`（2026年10月19日）は変えない
- `/terms` は改定しないので `revisedOn` を渡さない（表示は今のまま）

## 10. ドキュメントの更新

- `docs/02-database.md`: 3 章に `signupProfiles/{orgId}` を追加、5 章（ルール方針）の表に「全拒否」で追加
- `docs/04-features.md` F-01: 入力に 3 項目と経路を追記
- `docs/03-pages.md`: `/signup` の主な要素に 3 項目を追記
- `.claude/PROJECT.md`: 「Firestore」の表に `signupProfiles/{orgId}`（全拒否・運営画面のみ）、「モード」の近くに localStorage `meo-tool:signup-source`（経路・30 日）を追記
- この設計書の「状態」を実装後に更新する
- プライバシーポリシー本文は 9 章（`app/utils/privacy.ts`）

## 11. 判断の記録

### ヒアリングで決まったこと

0 章「決定事項」のとおり。

### 設計者（Claude）の判断（ヒアリングで提示し、異論なし）

- 保存先を運営専用のトップレベルコレクションにした（3 章）
- 電話番号は数字だけで保存し、0 始まり 10〜11 桁で検証する（1 章）
- 読み取るパラメーターは `utm_source` / `utm_medium` / `utm_campaign` / `ref` の 4 つ（2 章）
- 引き継ぎは localStorage・後勝ち・30 日（2 章）
- 運営画面は一覧に列、詳細にカード。既存組織は「—」/「登録情報なし」（6 章）
- 外部 API の `source` は任意（7 章）

### 設計者（Claude）の判断（ヒアリング後に決めたもの）

- 登録方法 `via`（画面 / 外部 API）を記録する。外部 API 経由の登録も「経路」の一つとして運営が見分けられるように
- 並び順は既存項目の後ろに参考ページの順で足す（5 章）
- 電話番号を画面側でも先に検証する（5 章）
- 経路の値が壊れていても登録は止めない（画面側は切り詰め・例外を握りつぶす。サーバー側は型違い・上限超えのみ拒否）
- プライバシーポリシーの文案（9 章）。営業・サービス案内には「希望しない場合は停止する」旨を添えた
- 改定日は「制定日」を残して「改定日」を別に表示する（9 章）
- リリースは Hosting と Functions を間を空けずに続けて出す（7 章）

### 実装者に任せること

- 「登録情報」カード・ラジオの細かな見た目（既存の運営画面・「ご利用の形態」に合わせる）
- `useSignupSource` の内部の書き方（localStorage のキーと 2 章の規則を守ること）
- テストの細かなケースの追加
