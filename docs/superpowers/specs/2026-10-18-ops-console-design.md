# 運営画面（/ops）の本接続 設計書

- 作成日: 2026-10-18
- 状態: 実装済み（2026-10-19）
- 関連: `docs/04-features.md` F-20、`docs/02-database.md`（`users.platformRole`・ルール表）、`docs/03-pages.md` 5.4、`docs/05-open-issues.md` I-15

## 0. 目的と範囲

### 目的

運営画面（`/ops/organizations` `/ops/organizations/[orgId]`）を、本番の Firebase で運営者が使える状態にする。現状は仮データ（`useOps` → `app/utils/mock/functions/ops.ts`）だけで動き、本番では `isOperator` が常に `false`（`app/utils/firebase/converters.ts`）のため入れない。

### 決定事項（ヒアリング結果）

| 項目 | 決定 |
| --- | --- |
| 範囲 | 既存の運営画面を**すべて**本接続する（権限付与・入口・一覧・詳細・利用停止 / 再開・プラン / 上限変更） |
| 権限の正 | Firebase Auth の Custom Claims `operator: true`。付与は CLI スクリプトのみ |
| データの読み方 | **運営専用の callable** で読む。Firestore ルールは運営者に広げない |
| 利用停止の効果 | **書き込み系を止める**。公開アンケートの受付・管理画面の操作・自動同期 / 自動計測を止め、閲覧（CSV 出力を含む）はできる |

### 範囲外

- 代理ログイン、組織の削除・退会処理、運営者の一覧画面（I-15）
- 運営操作の監査ログを閲覧する画面（記録だけ行う）
- デモ（仮データ）側の運営アカウント（`u-ops` はデモのログイン対象に加えない）

## 1. 権限の付与（CLI スクリプト）

`functions` に npm script を追加する。

```
npm --prefix functions run ops:grant -- <email>            # 付与
npm --prefix functions run ops:grant -- <email> --revoke   # 剥奪
```

- 場所: `functions/src/ops/__tests__/grantOperator.ts`（`rank:probe` と同じく `tsconfig.test.json` でビルドし `lib-test/` から実行する。デプロイ対象に含めない）
- `functions/serviceAccount.json` で Admin SDK を初期化し、メールアドレスからユーザーを引く。見つからなければエラーで終了する
- 付与: 既存の claims を保ったまま `operator: true` を加え（`setCustomUserClaims`）、`users/{uid}.platformRole` に `'operator'` を書く（`set` + `merge`）
- 剥奪: claims から `operator` を除き、`platformRole` を `null` にし、`revokeRefreshTokens(uid)` で既存のセッションを無効にする
- 発行済みの ID トークンは剥奪後も最大 1 時間有効なため、運営の 4 関数は ID トークンの claims に加えて Auth の今の claims（`getUser(uid).customClaims`）も確かめる（3.1）
- 判定は常に claims で行う。`platformRole` は Firestore 上の写しで、判定には使わない
- 実行後に「対象者は一度ログアウトして再ログインすること」と出力する（claims は ID トークンの再取得まで反映されない）

## 2. 画面側の入口

- `toUser(authUser, claims)` に変え、`isOperator: claims.operator === true` とする
- `useFirestoreSync` の `onAuthStateChanged` で `authUser.getIdTokenResult()` を待ってから `db.value.users` を設定する。`useBackendReady().waitForAuth()` はこの設定の後に解決させる（`ops.global.ts` が `isOperator` を見るのは `auth.global.ts` の待機の後のため、順序はファイル名順で保たれる）
- 表示名の手動反映（`useFirestoreSync.ts` 58 行目付近の `toUser($auth.currentUser)`）も既存の `isOperator` を引き継ぐ
- 入口のリンク（`/orgs` の運営リンク、管理画面ヘッダーの「運営画面」）と `ops.global.ts` の 404 は変更しない

## 3. Functions（`functions/src/ops/`）

### 3.1 権限

- `shared/auth.ts` の `Caller` に `isOperator: boolean`（`auth.token.operator === true`）を加える
- `shared/auth.ts` に `requireOperator(caller)` を追加。`isOperator` でなければ `permission-denied`（「運営権限がありません。」）
- 4 関数とも先頭で `requireOperator` を呼び、続けて Auth の今の claims でも `operator` を確かめる（剥奪をすぐに効かせるため。テストでは `OpsDeps.loadClaims` を差し替える）。`requireMember` / `requireOrg` は使わない（運営者は組織のメンバーではない）

### 3.2 関数

ハンドラーは `ops/organizations.ts` に置き、`index.ts` で `callable()` に包んで export する。

| ハンドラー | export | 入力 | 出力 / 処理 |
| --- | --- | --- | --- |
| `getOpsOrganizationsFunc` | `getOpsOrganizations` | なし | 全組織（`deleted` を除く）の概要の配列 |
| `getOpsOrganizationFunc` | `getOpsOrganization` | `orgId` | 1 組織の詳細。無ければ `not-found` |
| `updateOrganizationStatusFunc` | `updateOrganizationStatus` | `orgId`, `status: 'active' \| 'suspended'` | 状態を変え、公開アンケートを同期する |
| `updateOrganizationPlanFunc` | `updateOrganizationPlan` | `orgId`, `plan`, `limits` | プラン名と上限を変える |

**一覧の各行**（`useOps` の `organizations` と同じ形）

| 項目 | 取り方 |
| --- | --- |
| `org` | `organizations/{orgId}` |
| `ownerName` / `ownerEmail` | `organizations/{orgId}/members/{ownerUid}` の `displayName` / `email`（無ければ `—`） |
| `stores` | `stores` の `status == 'active'` を `count()` |
| `members` | `members` を `count()` |
| `hasConnectionError` | `googleConnections` の `status == 'error'` を `limit(1)` |

組織ごとの読み取りは `Promise.all` で並べる。組織数が数百を超えたらページングを検討する（今回は入れない）。

**詳細**: 一覧の 1 行に加え、`connections`（`googleConnections` 全件。トークン・秘密は含まれないコレクション）、`usage`（`usageMonthly/{今月}`。月キーは `rankings/validation.ts` の `toJstMonthKey`。無ければ `null`）、`memberList`（`members` 全件）、`storeList`（`stores` 全件）。

### 3.3 書き込み

両方とも 1 つのトランザクションで本体と監査ログ（`writeAuditLog`。`organizations/{orgId}/auditLogs`、`actorUid` は運営者の uid）を書く。

- `updateOrganizationStatus`
  - `deleted` の組織と、存在しない組織は `not-found`
  - 同じ状態への変更は何もせず成功で返す（冪等）
  - 監査ログ: `action: 'ops.updateOrganizationStatus'`、`payload: { from, to }`
  - 公開アンケートの同期（同じトランザクション）: その組織の `publicSurveys`（`where('orgId', '==', orgId)`）を読み、
    - 停止時: すべて `status: 'paused'`
    - 再開時: 元の `surveys/{surveyId}.status` が `published` のものだけ `published`、それ以外は `paused`
- `updateOrganizationPlan`
  - `plan` は空でない 50 文字以内（`requireString(value, 'プラン名', 50)`）、`limits` の 6 項目はすべて 0 以上の整数。整数の検証 helper は無いため `ops/organizations.ts` に `requireLimits` を置く
  - 監査ログ: `action: 'ops.updateOrganizationPlan'`、`payload: { plan, limits }`（変更前の値も `before` として残す）

## 4. 利用停止の穴埋め

`requireOrg`（`status !== 'active'` で `failed-precondition`）を通っていない書き込みに追加する。

| ハンドラー | 対応 |
| --- | --- |
| `updateMemberRoleFunc` / `deleteMemberFunc`（`identity/members.ts`） | `requireOrg` を追加 |
| `createReplyTemplateFunc` / `updateReplyTemplateFunc` / `deleteReplyTemplateFunc`（`gbp/templates.ts`） | `requireOrg` を追加 |
| `updateStoreArchiveFunc`（`stores/stores.ts`） | `requireOrg` を追加 |
| `postSurveyResponse`（`responses/responses.ts`） | トランザクション内で `organizations/{orgId}` を読み、`active` でなければ `CLOSED_MESSAGE`。再送（保存済みの `submissionId`）は今と同じく保存済みの結果を返す |
| `deleteGoogleConnectionFunc` / `deleteGoogleOAuthClientFunc` | **停止中も許可**（権限・秘密を減らす操作のため）。変更しない |
| 読み取り系（`getGoogleOAuthConfig`・CSV など） | 停止中も許可。変更しない |

自動同期（`scheduledGbpReviewsSync`）と自動計測（`scheduledRankCheck`）は、すでに `status === 'active'` の組織だけを処理しているため変更しない。

## 5. 画面の接続

- `useOps` を他の composable と同じく `isMock` で切り替える。デモ中は今の仮データ、それ以外は callable
- 本接続時は画面を開いたときに `getOpsOrganizations` / `getOpsOrganization` を 1 回呼ぶ（購読しない）。停止・プラン変更の成功後に該当の詳細を読み直す
- 読み込み中・エラーの表示を一覧と詳細に加える（既存の `UiCommonAlert` を使う）
- 上限の入力欄が空・数値でないときは 0 ではなく `null` として送り、サーバーで拒否させる（`Number('')` は 0 になる。`NaN` は callable の SDK が送信前に例外にするため使わない）
- `PROJECT.md` にある `FIREBASE_READY_PATHS` は実物に存在しない（画面ごとの `isMock` 分岐で切り替えている）。記述を実物に合わせて直す（6 章）

## 6. 資料の更新

- `docs/02-database.md` のルール表「すべて：運営は読取可」を「運営は Firestore を直接読まず、運営専用の callable（`getOpsOrganizations` / `getOpsOrganization`）を使う」に改める
- `.claude/PROJECT.md`: 「運営画面の本接続は未着手」を改め、`ops:grant` の手順と、Functions のフォルダに `ops/` を追記する

## 7. エラー処理

| 状況 | 返すエラー |
| --- | --- |
| 未ログイン | `unauthenticated`（既存の `requireCaller`） |
| claims に `operator` が無い | `permission-denied` |
| 組織が無い / `deleted` | `not-found` |
| 上限値・プラン名が不正 | `invalid-argument` |
| 停止中の組織への書き込み（メンバー側） | `failed-precondition`「この組織は利用停止中です。」 |

## 8. テスト

`*.itest.ts`（`npm run test:emulator`）で確認する。ハンドラーは `Caller` を受け取るため、テストでは `{ uid, email, isOperator }` を直接渡す。`requireCaller` が `auth.token.operator` から `isOperator` を作ることは `shared/__tests__` の単体テスト（`*.test.ts`）で確認する。

- 正常系: 一覧の件数・オーナー・店舗数・連携エラー、詳細の各項目、停止 → 再開で `publicSurveys` が元に戻る、プラン変更、監査ログが 1 件ずつ書かれる
- 異常系: claims なし・`operator: false` で 4 関数とも拒否、存在しない / `deleted` の組織、停止中の回答・メンバー変更・テンプレート・アーカイブが拒否される
- 境界値: 上限 0 は可、負数・小数・文字列は不可、プラン名 0 / 50 / 51 文字、同じ状態への変更（冪等）、停止中の再送は保存済みの結果を返す
- 既存機能への影響: 停止中でも Google 連携の解除・OAuth クライアントの削除・CSV 出力ができる、active の組織では既存の書き込みが従来どおり通る

画面は `npm run dev` + Functions Emulator（`npm --prefix functions run serve`）で確認する。Auth / Firestore は本番のため、`ops:grant` は**本番のユーザーに権限を付ける**。確認用のアカウントに付与 → 再ログイン → 一覧・詳細・停止 / 再開・プラン変更を通しで確認し、停止 / 再開・プラン変更は確認用の組織だけで行う。
