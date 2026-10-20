# 新規登録の追加項目と登録経路の記録 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規登録（画面・外部 API）で電話番号・業種・運営店舗数を必須で受け取り、名刺・広告リンクのクエリから登録経路を記録して、運営画面で確認できるようにする。

**Architecture:** 追加項目と経路は `createOrganization` の同じトランザクションで、ルールで全拒否のトップレベル `signupProfiles/{orgId}` に書く。運営画面は既存の ops callable の `summarize` で一緒に読む。経路は起動時の plugin が URL から localStorage に移し、登録時に送って成功後に消す。

**Tech Stack:** Nuxt 4 SPA / Firebase Auth・Firestore・Functions v2（Node 24・TypeScript・CommonJS）/ `node:test` / `@firebase/rules-unit-testing`

**Spec:** `docs/superpowers/specs/2026-10-20-signup-profile-design.md`

## Global Constraints

- コミットは**ユーザーの明示許可があるときだけ**行う。各タスク末尾は「確認」（`git status` と差分の要約）
- 運営店舗数の値とラベル: `'1'` 1店舗 / `'2'` 2店舗 / `'3-5'` 3〜5店舗 / `'6+'` 6店舗以上（この順）
- 業種の値とラベル: `'salon'` サロン / `'bodywork'` 整体・整骨院 / `'beauty'` 美容 / `'unmanned'` 無人店舗 / `'other'` その他（この順）
- 登録方法 `via` のラベル: `signup` 新規登録画面 / `externalApi` 外部 API
- 電話番号の正規化: `normalize('NFKC')` → `/[\s()\-‐‑–—―−ー]/g` を除去 → `^0\d{9,10}$`。保存は数字だけ。画面と Functions で同じ規則
- エラー文言: 「電話番号を入力してください。」「電話番号の形式が正しくありません。」「業種の値が正しくありません。」「運営店舗数の値が正しくありません。」「登録経路の値が正しくありません。」
- 経路のクエリ: `utm_source` `utm_medium` `utm_campaign` `ref` → 保存名 `utmSource` `utmMedium` `utmCampaign` `ref`、加えて `landingPath` `capturedAt`
- 経路の上限: 4 つの値は 100 文字、`landingPath` 200 文字、`capturedAt` 40 文字。画面は切り詰め、Functions は超えたら拒否
- localStorage のキー `meo-tool:signup-source`、有効期限 30 日、後勝ち。読み書きの例外は握りつぶす（登録を止めない）
- 保存先 `signupProfiles/{orgId}`。`firestore.rules` は変更しない（未記載は全拒否）
- プライバシーポリシーの文面は spec 9 章の文案を**一字一句そのまま**使う
- Tailwind クラスは `app/` 配下の `.vue` / `.ts` にだけ書く。クラス名を文字列連結で作らない
- `.nuxt/` `functions/lib/` `functions/lib-test/` は編集しない
- 単体テスト: `npm --prefix functions test`。結合・ルールテスト: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`（ルート）。型: `npm run typecheck`（ルート）と `npm --prefix functions run build`
- `npm --prefix functions run serve` は本番の Auth / Firestore に書き込む。**画面から実際に登録する確認は、ユーザーの許可を得てから行う**

## Review Focus

- `?ref=`（空）や `?ref=%20` で開いても、保存済みの経路を消さない・上書きしない（Task 4 の手動確認）
- localStorage が使えない（Safari のプライベートモード等）と、経路なしで登録が通る（Task 4・5 のコード確認。`try/catch` が `capture` `load` `clear` の 3 か所すべてにあること）
- 外部 API が `source` に文字列や配列を送ると `invalid-argument`、知らないキーは無視（Task 1 のテスト）
- 国際表記の電話番号（`+81 90-1234-5678`）は「電話番号の形式が正しくありません。」で弾く（Task 1 のテスト）
- 運営画面の一覧で、`signupProfiles` の無い既存組織が混ざっても検索・表示が落ちない（Task 3 のテスト `signup: null` + Task 6 の検索の `?.`）

---

## File Structure

| ファイル | 役割 |
| --- | --- |
| `functions/src/shared/validation.ts`（変更） | `requirePhone` |
| `functions/src/identity/signupProfile.ts`（新規） | 追加項目と経路の型・入力の解析・`signupProfileRef` |
| `functions/src/identity/createOrganization.ts`（変更） | 入力に `profile` / `via`、トランザクションで `signupProfiles` を作る |
| `functions/src/identity/createAccount.ts`（変更） | `via: 'externalApi'` を渡す |
| `functions/src/ops/organizations.ts`（変更） | `OpsOrganizationSummary.signup` |
| `app/types/domain.ts`（変更） | `Industry` `StoreCount` `SignupVia` `SignupSource` `SignupProfile` |
| `app/utils/signupProfile.ts`（新規） | 選択肢・ラベル・電話番号の正規化・URL からの経路の取り出し |
| `app/composables/useSignupSource.ts`（新規） | localStorage の保存・読み出し・削除 |
| `app/plugins/signup-source.client.ts`（新規） | 起動時に `capture()` |
| `app/composables/useAuth.ts`（変更） | 追加項目と経路を送り、成功後に経路を消す |
| `app/pages/signup.vue`（変更） | 入力欄 3 つ |
| `app/components/Ui/Input/TextField.vue` / `SelectField.vue`（変更） | `'tel'`・`isRequired` |
| `app/composables/useOps.ts`・`app/pages/ops/organizations/index.vue`・`[orgId].vue`（変更） | 列・カード |
| `app/utils/privacy.ts`・`app/pages/privacy.vue`・`app/components/Landing/Common/LegalDocument.vue`（変更） | ポリシー改定・改定日 |

---

### Task 1: Functions の入力解析（`requirePhone`・`parseSignupProfileInput`）

**Files:**
- Modify: `functions/src/shared/validation.ts`
- Create: `functions/src/identity/signupProfile.ts`
- Test: `functions/src/shared/__tests__/validation.test.ts`、`functions/src/identity/__tests__/signupProfile.test.ts`（新規）

**Interfaces:**
- Produces:
  - `requirePhone(value: unknown): string`（`validation.ts`）
  - `signupProfile.ts`: `INDUSTRIES` / `STORE_COUNTS`（`readonly` 配列。Global Constraints の順）、`type Industry` / `type StoreCount` / `type SignupVia = 'signup' | 'externalApi'`、`interface SignupSource { utmSource; utmMedium; utmCampaign; ref; landingPath; capturedAt }`（各 `string | null`）、`interface SignupProfileInput { phone: string; industry: Industry; storeCount: StoreCount; source: SignupSource | null }`、`parseSignupProfileInput(input: Record<string, unknown>): SignupProfileInput`、`signupProfileRef(db: Firestore, orgId: string): DocumentReference`（`signupProfiles/{orgId}`）

- [ ] **Step 1: 失敗するテストを書く**

`validation.test.ts` の import に `requirePhone` を足し、末尾に追加:

```ts
test('requirePhone: 全角・ハイフン・括弧・空白を除いて数字だけにする', () => {
  assert.equal(requirePhone('090-1234-5678'), '09012345678')
  assert.equal(requirePhone('０３（１２３４）５６７８'), '0312345678')
  assert.equal(requirePhone(' 03 1234 5678 '), '0312345678')
  assert.equal(requirePhone('090ー1234ー5678'), '09012345678')
})

test('requirePhone: 0 始まり 10〜11 桁以外は invalid-argument', () => {
  const message = '電話番号の形式が正しくありません。'
  for (const value of ['031234567', '090123456789', '9012345678', '+81 90-1234-5678', '090-1234-567a']) {
    assert.throws(() => requirePhone(value), { code: 'invalid-argument', message })
  }
  assert.throws(() => requirePhone(''), { message: '電話番号を入力してください。' })
  assert.throws(() => requirePhone(9012345678), invalid)
})
```

`signupProfile.test.ts`（新規）:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignupProfileInput } from '../signupProfile'

const base = { phone: '090-1234-5678', industry: 'salon', storeCount: '3-5' }
const EMPTY_SOURCE = { utmSource: null, utmMedium: null, utmCampaign: null, ref: null, landingPath: null, capturedAt: null }

test('3 項目を読み、source が無ければ null', () => {
  assert.deepEqual(parseSignupProfileInput(base), { phone: '09012345678', industry: 'salon', storeCount: '3-5', source: null })
})

test('選択肢にない業種・店舗数、欠落は invalid-argument', () => {
  assert.throws(() => parseSignupProfileInput({ ...base, industry: 'restaurant' }), { code: 'invalid-argument', message: '業種の値が正しくありません。' })
  assert.throws(() => parseSignupProfileInput({ ...base, storeCount: '3' }), { code: 'invalid-argument', message: '運営店舗数の値が正しくありません。' })
  assert.throws(() => parseSignupProfileInput({ phone: base.phone, industry: 'salon' }), { code: 'invalid-argument' })
})

test('source: 空・null は null にそろえ、全部空なら source ごと null。知らないキーは無視', () => {
  assert.equal(parseSignupProfileInput({ ...base, source: null }).source, null)
  assert.equal(parseSignupProfileInput({ ...base, source: { ref: ' ', utmSource: null } }).source, null)
  assert.deepEqual(parseSignupProfileInput({ ...base, source: { ref: ' card-tanaka ', unknown: 'x' } }).source, { ...EMPTY_SOURCE, ref: 'card-tanaka' })
})

test('source: オブジェクト以外・文字列以外の値・上限超えは invalid-argument', () => {
  const error = { code: 'invalid-argument', message: '登録経路の値が正しくありません。' }
  assert.throws(() => parseSignupProfileInput({ ...base, source: 'google' }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: [] }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { ref: 1 } }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { ref: 'a'.repeat(101) } }), error)
  assert.doesNotThrow(() => parseSignupProfileInput({ ...base, source: { landingPath: `/${'a'.repeat(199)}` } }))
  assert.throws(() => parseSignupProfileInput({ ...base, source: { landingPath: `/${'a'.repeat(200)}` } }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { capturedAt: 'a'.repeat(41) } }), error)
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npm --prefix functions test`
Expected: `tsc` が `requirePhone` / `../signupProfile` を見つけられずに失敗する

- [ ] **Step 3: `requirePhone` を実装する**

`requireString(value, '電話番号', 30)` → Global Constraints の正規化 → パターン不一致は `fail('invalid-argument', '電話番号の形式が正しくありません。')`。

- [ ] **Step 4: `signupProfile.ts` を実装する**

`phone` は `requirePhone`、`industry` / `storeCount` は既存の `requireOneOf`（ラベル「業種」「運営店舗数」）。`source` は「`undefined` / `null` → `null`、配列・オブジェクト以外 → 拒否、各キーは `undefined` / `null` / trim 後の空 → `null`、文字列以外・上限超え → 拒否、全部 `null` → `null`」。

- [ ] **Step 5: 通ることを確かめる**

Run: `npm --prefix functions test`
Expected: すべて PASS

- [ ] **Step 6: 確認**

`git status` で変更 4 ファイルを確かめる（コミットしない）

---

### Task 2: 組織作成で `signupProfiles` を書く（画面・外部 API）

**Files:**
- Modify: `functions/src/identity/createOrganization.ts`、`functions/src/identity/createAccount.ts`
- Test: `functions/src/identity/__tests__/createOrganization.itest.ts`、`createAccount.itest.ts`、`functions/src/__tests__/firestore.rules.itest.ts`
- Docs: `docs/02-database.md`（3 章に `signupProfiles/{orgId}`、5 章のルール表に「全拒否」）、`.claude/PROJECT.md`「Firestore」の表に `signupProfiles/{orgId}`（全拒否・運営画面の callable だけが読む）

**Interfaces:**
- Consumes: Task 1 の `parseSignupProfileInput` / `signupProfileRef` / `SignupProfileInput` / `SignupVia`
- Produces:
  - `CreateOrganizationInput` に `profile: SignupProfileInput` と `via: SignupVia`
  - `parseCreateOrganizationInput(data: unknown): Omit<CreateOrganizationInput, 'via'>`（`profile` を読む）
  - `signupProfiles/{orgId}` のフィールド: `orgId` `ownerUid` `phone` `industry` `storeCount` `via` `source` `createdAt`（`serverTimestamp`）

- [ ] **Step 1: 失敗するテストを書く**

`createOrganization.itest.ts` の `input` に `phone: '03-1234-5678', industry: 'salon', storeCount: '1'` を足し、追加:

```ts
test('signupProfiles/{orgId} を via: signup で作る', async () => {
  const source = { ref: 'card-tanaka', landingPath: '/', capturedAt: '2026-10-20T00:00:00.000Z' }
  const { orgId } = await createOrganizationFunc(db, caller('u-1'), { ...input, source })
  const profile = (await db.doc(`signupProfiles/${orgId}`).get()).data()!
  assert.equal(profile.orgId, orgId)
  assert.equal(profile.ownerUid, 'u-1')
  assert.equal(profile.phone, '0312345678')
  assert.equal(profile.industry, 'salon')
  assert.equal(profile.storeCount, '1')
  assert.equal(profile.via, 'signup')
  assert.deepEqual(profile.source, { utmSource: null, utmMedium: null, utmCampaign: null, ...source })
  assert.ok(profile.createdAt)
})

test('経路が無ければ source は null', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1'), input)
  assert.equal((await db.doc(`signupProfiles/${orgId}`).get()).get('source'), null)
})

test('再送で signupProfiles を上書きしない', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1'), input)
  await createOrganizationFunc(db, caller('u-1'), { ...input, storeCount: '6+' })
  assert.equal((await db.doc(`signupProfiles/${orgId}`).get()).get('storeCount'), '1')
})

test('追加項目が無いと invalid-argument で、組織もプロフィールも作らない', async () => {
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, phone: undefined }), { code: 'invalid-argument', message: '電話番号を入力してください。' })
  assert.equal((await db.doc('organizations/org-req12345678').get()).exists, false)
  assert.equal((await db.collection('signupProfiles').get()).size, 0)
})
```

`createAccount.itest.ts` の `input` に同じ 3 項目を足し、追加:

```ts
test('signupProfiles を via: externalApi で作る', async () => {
  await createAccountFunc(db, { ...input, source: { utmSource: 'google', utmMedium: 'cpc' } }, fakeAuth())
  const profile = (await db.doc('signupProfiles/org-ext-req12345678').get()).data()!
  assert.equal(profile.via, 'externalApi')
  assert.equal(profile.ownerUid, 'ext-req12345678')
  assert.equal(profile.source.utmSource, 'google')
})

test('追加項目が無いと invalid-argument で、Auth ユーザーを作らない', async () => {
  const auth = fakeAuth()
  await assert.rejects(createAccountFunc(db, { ...input, industry: undefined }, auth), { code: 'invalid-argument' })
  assert.equal(auth.users.size, 0)
})
```

`firestore.rules.itest.ts` の `beforeEach` の seed に `setDoc(doc(db, 'signupProfiles/org-a'), { orgId: 'org-a', ownerUid: 'u-owner', phone: '0312345678' })` を足し、追加:

```ts
test('signupProfiles は組織の owner でも読めない', async () => {
  await assertFails(getDoc(doc(as('u-owner'), 'signupProfiles/org-a')))
  await assertFails(getDoc(doc(anonymous(), 'signupProfiles/org-a')))
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: 新しい `signupProfiles` のテストが FAIL（ドキュメントが無い）。ルールのテストは PASS してよい（未記載は全拒否のため）

- [ ] **Step 3: `createOrganization.ts` を変える**

`parseCreateOrganizationInput` は `profile: parseSignupProfileInput(input)` を加えて返す。`createOrganizationFunc` は `{ ...parse(data), via: 'signup' }` を渡す。トランザクションの `tx.create(memberRef(...))` の後で `tx.create(signupProfileRef(db, orgId), { orgId, ownerUid: caller.uid, ...profile, via, createdAt: now })`。

- [ ] **Step 4: `createAccount.ts` を変える**

`createOrganization` の第 3 引数に `via: 'externalApi'` を足す（`parseCreateOrganizationInput` は今のまま Auth ユーザー作成より前に呼ばれていること）。

- [ ] **Step 5: 通ることを確かめる**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` と `npm --prefix functions test` と `npm --prefix functions run build`
Expected: すべて PASS、build エラーなし

- [ ] **Step 6: ドキュメントを更新して確認**

上の Docs 2 ファイルを更新し、`git status` で確かめる（コミットしない）

---

### Task 3: 運営の callable に `signup` を載せる

**Files:**
- Modify: `functions/src/ops/organizations.ts`
- Test: `functions/src/ops/__tests__/organizations.itest.ts`

**Interfaces:**
- Consumes: Task 1 の `signupProfileRef`・型
- Produces: `interface OpsSignupProfile { phone: string; industry: Industry; storeCount: StoreCount; via: SignupVia; source: SignupSource | null }`、`OpsOrganizationSummary.signup: OpsSignupProfile | null`（一覧・詳細の両方）

- [ ] **Step 1: 失敗するテストを書く**

`beforeEach` に追加:

```ts
await db.doc('signupProfiles/org-a').set({
  orgId: 'org-a', ownerUid: 'u-owner', phone: '0312345678', industry: 'beauty', storeCount: '2', via: 'signup',
  source: { utmSource: null, utmMedium: null, utmCampaign: null, ref: 'card-tanaka', landingPath: '/', capturedAt: '2026-10-20T00:00:00.000Z' },
  createdAt: new Date(),
})
```

追加:

```ts
test('一覧・詳細に登録情報が載る。プロフィールの無い組織は null', async () => {
  const expected = {
    phone: '0312345678', industry: 'beauty', storeCount: '2', via: 'signup',
    source: { utmSource: null, utmMedium: null, utmCampaign: null, ref: 'card-tanaka', landingPath: '/', capturedAt: '2026-10-20T00:00:00.000Z' },
  }
  const list = await getOpsOrganizationsFunc(db, OPS, {}, DEPS)
  assert.deepEqual(list.find(item => item.org.id === 'org-a')!.signup, expected)
  assert.equal(list.find(item => item.org.id === 'org-b')!.signup, null)
  assert.deepEqual((await getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, DEPS)).signup, expected)
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: 新しいテストが FAIL（`signup` が `undefined`）

- [ ] **Step 3: `summarize` を変える**

既存の `Promise.all` に `signupProfileRef(db, org.id).get()` を足し、あれば上の 5 項目だけを返す（`orgId` `ownerUid` `createdAt` は含めない）。無ければ `null`。

- [ ] **Step 4: 通ることを確かめる**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` と `npm --prefix functions run build`
Expected: すべて PASS

- [ ] **Step 5: 確認**

`git status`（コミットしない）

---

### Task 4: 画面の土台（型・選択肢・経路の保存）

**Files:**
- Modify: `app/types/domain.ts`、`.claude/PROJECT.md`（「モード」節の近くに「登録経路は localStorage `meo-tool:signup-source` に 30 日。`app/plugins/signup-source.client.ts` が起動時に保存」）
- Create: `app/utils/signupProfile.ts`、`app/composables/useSignupSource.ts`、`app/plugins/signup-source.client.ts`

**Interfaces:**
- Produces:
  - `domain.ts`: `type Industry`・`type StoreCount`・`type SignupVia`・`interface SignupSource`・`interface SignupProfile`（Task 3 の `OpsSignupProfile` と同じ形）
  - `app/utils/signupProfile.ts`: `INDUSTRY_OPTIONS: { value: Industry; label: string }[]`・`STORE_COUNT_OPTIONS: { value: StoreCount; label: string }[]`（Global Constraints の順）、`INDUSTRY_LABELS: Record<Industry, string>`・`STORE_COUNT_LABELS: Record<StoreCount, string>`・`SIGNUP_VIA_LABELS: Record<SignupVia, string>`、`normalizePhone(value: string): string`、`isValidPhone(value: string): boolean`（正規化後に判定）、`signupSourceLabel(source: SignupSource | null): string | null`（`ref ?? utmSource ?? null`）、`extractSignupSource(search: string, pathname: string, now: Date): SignupSource | null`（4 つとも trim 後に空なら `null`。上限で切り詰め）
  - `useSignupSource(): { capture(): void; load(): SignupSource | null; clear(): void }`。`capture` は `window.location` を読み、`extractSignupSource` が `null` なら何もしない。`load` は `capturedAt` から 30 日を過ぎていたら削除して `null`

- [ ] **Step 1: 型と `app/utils/signupProfile.ts` を書く**

- [ ] **Step 2: `useSignupSource` と plugin を書く**

plugin は `export default defineNuxtPlugin(() => { useSignupSource().capture() })`。`capture` / `load` / `clear` の localStorage 操作はそれぞれ `try/catch` で包む。

- [ ] **Step 3: 型を確かめる**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: 画面で確かめる（本番に書き込まない）**

`npm run dev` を起動し、ブラウザで次を確かめる（localStorage は開発者ツールか `javascript_tool` で読む）:
- `/?ref=card-test&utm_source=google` → `meo-tool:signup-source` に `ref: 'card-test'`・`utmSource: 'google'`・`landingPath: '/'`
- そのまま「アカウント登録」で `/signup` へ → 値が残る
- `/?ref=` と `/?ref=%20` を開く → 値は変わらない
- `/?ref=card-2` → `ref: 'card-2'` に上書き、`utmSource: null`
- `capturedAt` を 31 日前に書き換えて `/signup` を開き、`load()` 相当で削除されることを確認（Task 5 の後に登録ボタン直前で確かめてもよい）

- [ ] **Step 5: PROJECT.md を更新して確認**

`git status`（コミットしない）

---

### Task 5: 新規登録画面と `useAuth.signup`

**Files:**
- Modify: `app/pages/signup.vue`、`app/composables/useAuth.ts`、`app/components/Ui/Input/TextField.vue`、`app/components/Ui/Input/SelectField.vue`
- Docs: `docs/04-features.md` F-01 の「入力」に「電話番号・業種・運営店舗数（必須）、登録経路（クエリ `utm_source` `utm_medium` `utm_campaign` `ref`）」、`docs/03-pages.md` の `/signup` の主な要素に 3 項目

**Interfaces:**
- Consumes: Task 4 の `INDUSTRY_OPTIONS` `STORE_COUNT_OPTIONS` `normalizePhone` `isValidPhone` `useSignupSource`、型 `Industry` `StoreCount`
- Produces: `SignupInput` に `phone: string; industry: Industry; storeCount: StoreCount`

- [ ] **Step 1: 共通部品を変える**

`TextField` の `type` に `'tel'`。`SelectField` に `isRequired?: boolean`（既定 `false`。`TextField` と同じ「必須」バッジ、`<select :required>`）。

- [ ] **Step 2: `useAuth.signup` を変える**

先頭（`leaveDemo()` の後、Auth ユーザー作成より前）で `isValidPhone(input.phone)` でなければ `throw new MockFunctionsError('invalid-argument', '電話番号の形式が正しくありません。')`。`createOrganization` の送信内容に `phone: normalizePhone(input.phone)`・`industry`・`storeCount`・`source: load()` を足す。`waitForOrg` の後で `clear()`。

- [ ] **Step 3: `signup.vue` を変える**

spec 5 章の並び順（パスワードの後に 電話番号 → 運営店舗数 → 業種）。電話番号は `type="tel" autocomplete="tel" is-required :maxlength="20" placeholder="例: 090-1234-5678"`。運営店舗数は「ご利用の形態」と同じカード型ラジオ（`grid-cols-2 sm:grid-cols-4`、説明文なし、`legend` に「運営店舗数」と必須バッジ）。業種は `UiInputSelectField` に `is-required`、先頭 `{ value: null, label: '選択してください', isDisabled: true }`。`canSubmit` に `phone.value.trim() !== ''`・`storeCount.value !== null`・`industry.value !== null`。

- [ ] **Step 4: 型と画面を確かめる（本番に書き込まない）**

Run: `npm run typecheck` → エラーなし。
`npm run dev` で `/signup` を開き:
- 3 項目が spec の順に出て、未入力・未選択の間は「登録する」が押せない
- 業種の初期表示が「選択してください」で、選び直せない
- 電話番号に `0312` を入れて送信 → 「電話番号の形式が正しくありません。」が出る（Auth ユーザーは作られない。メールは使っていない架空のものにする）

- [ ] **Step 5: ドキュメントを更新して確認**

`git status`（コミットしない）

---

### Task 6: 運営画面（一覧の列・詳細のカード）

**Files:**
- Modify: `app/composables/useOps.ts`、`app/pages/ops/organizations/index.vue`、`app/pages/ops/organizations/[orgId].vue`

**Interfaces:**
- Consumes: Task 3 の `signup`、Task 4 の `SignupProfile` `INDUSTRY_LABELS` `STORE_COUNT_LABELS` `SIGNUP_VIA_LABELS` `signupSourceLabel`、既存の `formatDateTime`
- Produces: `useOps` の `OpsOrganizationSummary.signup: SignupProfile | null`、`mockSummary` は `signup: null`

- [ ] **Step 1: `useOps.ts` を変える**

- [ ] **Step 2: 一覧を変える**

「Google 連携」の前に列「登録経路」: `signupSourceLabel(item.signup?.source ?? null) ?? '—'`、`item.signup?.via === 'externalApi'` なら下に小さく「外部 API」。検索の対象に `ref` `utmSource` `utmMedium` `utmCampaign`（`null` は飛ばす）。検索欄のラベル「組織名・オーナーのメール・登録経路で検索」。空行の `colspan="8"`。

- [ ] **Step 3: 詳細を変える**

「利用状態」カードの次に `UiCommonCard title="登録情報"`。`dl` で 電話番号 / 業種 / 運営店舗数 / 登録方法 / ref / utm_source / utm_medium / utm_campaign / 最初に開いたページ / 経路の保存日時（`formatDateTime`）。無い値は `—`。`signup` が `null` なら本文に「登録情報はありません（この項目を追加する前に登録された組織です）。」

- [ ] **Step 4: 型を確かめる**

Run: `npm run typecheck`
Expected: エラーなし。画面での表示確認は Task 8（本番データを使うため許可を得てから）

- [ ] **Step 5: 確認**

`git status`（コミットしない）

---

### Task 7: プライバシーポリシーの改定と改定日

**Files:**
- Modify: `app/utils/privacy.ts`、`app/pages/privacy.vue`、`app/components/Landing/Common/LegalDocument.vue`

**Interfaces:**
- Produces: `PRIVACY_REVISED_ON = '2026年10月20日'`（`privacy.ts`。リリース日が決まったら差し替える）、`LegalDocument` の任意 prop `revisedOn?: string`

- [ ] **Step 1: 本文を改定する**

spec 9 章の「取得する情報」「利用目的」「Cookie 等の利用」の文案を、指定の位置に一字一句そのまま反映する（太字の印は付けない。プレーンな文字列）。

- [ ] **Step 2: 改定日を表示する**

`LegalDocument.vue` の「{{ enactedOn }} 制定」の次の行に、`revisedOn` があれば「{{ revisedOn }} 改定」。`privacy.vue` だけが `:revised-on="PRIVACY_REVISED_ON"` を渡す。

- [ ] **Step 3: 確かめる**

Run: `npm run typecheck` → エラーなし。`npm run dev` で `/privacy` に追記が出て、末尾が「2026年10月19日 制定 / 2026年10月20日 改定」、`/terms` は今のまま

- [ ] **Step 4: 確認**

`git status`（コミットしない）

---

### Task 8: 全体の確認と仕上げ

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-signup-profile-design.md`（「状態」を「実装済み（日付）」に）

- [ ] **Step 1: 自動の確認をすべて通す**

Run: `npm run typecheck`、`npm --prefix functions run build`、`npm --prefix functions test`、`PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: すべてエラーなし・PASS

- [ ] **Step 2: 本番に書き込む通し確認（ユーザーの許可を得てから）**

`npm --prefix functions run serve` + `npm run dev` で、`/?ref=card-test` → 登録 → 運営画面の一覧に `card-test`、詳細に登録情報が出る / localStorage から消える。**本番の Auth・Firestore にテスト用の組織が残るため、実施するか・誰が行うか・後片付けをユーザーに確認する**

- [ ] **Step 3: 仕様書の状態を更新し、全体の差分を要約して報告する**

報告には、リリース手順（spec 7 章: 外部システムの改修確認 → Hosting → 間を空けず Functions）と `PRIVACY_REVISED_ON` の差し替えを含める。コミットはユーザーの許可を待つ
