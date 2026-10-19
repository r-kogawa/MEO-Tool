# 運営画面（/ops）の本接続 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営者（Custom Claims `operator: true`）が本番の Firebase で `/ops` の一覧・詳細・利用停止 / 再開・プラン変更を使えるようにし、利用停止を書き込み系すべてに効かせる。

**Architecture:** 権限は ID トークンの claims を正とし、Functions の `Caller.isOperator` と画面の `User.isOperator` に流す。運営画面のデータは Firestore ルールを広げず、`functions/src/ops/` の callable 4 つだけで読み書きする。利用停止は既存の `requireOrg` を抜けている書き込みに足して揃える。

**Tech Stack:** Nuxt 4 SPA / Firebase Auth・Firestore・Functions v2（Node 24・TypeScript・CommonJS）/ `node:test`

**Spec:** `docs/superpowers/specs/2026-10-18-ops-console-design.md`

## Global Constraints

- コミットは**ユーザーの明示許可があるときだけ**行う。各タスク末尾の「確認」で差分を見せて可否を聞く
- region は `setGlobalOptions` の `asia-northeast1`。新しい callable は `shared/callable.ts` の `callable()` で包む
- ハンドラー名は `xxxFunc`、`index.ts` の export は `xxx`
- firebase-admin の初期化は `functions/src/index.ts` の 1 回だけ。CLI スクリプトは別プロセスなので自前で初期化してよい
- `.nuxt/` `functions/lib/` `functions/lib-test/` は編集しない
- Tailwind クラスは `app/` 配下の `.vue` / `.ts` にだけ書く。クラス名を文字列連結で作らない
- 結合テストは Java 21 が必要: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`（ルート）
- 単体テスト: `npm --prefix functions test`。型: `npm run typecheck`（ルート）と `npm --prefix functions run build`
- エラー文言（画面にそのまま出る）: 「運営権限がありません。」「組織が見つかりません。」「上限値は 0 以上の整数で入力してください。」「この組織は利用停止中です。」（既存）

## Review Focus

- 上限の入力欄を空にして保存 → 0 で保存されず「上限値は 0 以上の整数で入力してください。」になる（Task 7 のページ修正 + Task 4 のテスト `null`）
- 運営者が停止中の組織を再開したとき、停止前に一時停止していたアンケートは一時停止のまま、終了していたものは公開データに戻らない（Task 4 のテスト）
- 剥奪（`--revoke`）後も既存セッションで運営画面が使える → `revokeRefreshTokens` で切れる（Task 5。手動確認）
- ログイン直後に `/ops/...` へリダイレクトしたとき、claims の読み込み前に 404 にならない（Task 6。`isAuthReady` を claims 取得後に立てる）
- 停止中に送信途中だった回答の再送（同じ `submissionId`）は、保存済みなら結果を返す（Task 2 のテスト）

---

## File Structure

| ファイル | 役割 |
| --- | --- |
| `functions/src/shared/auth.ts`（変更） | `Caller.isOperator`・`requireOperator` |
| `functions/src/__tests__/emulator.ts`（変更） | テスト用 `caller()` に `isOperator: false`、`operatorCaller()` を追加 |
| `functions/src/ops/organizations.ts`（新規） | 運営の 4 ハンドラー |
| `functions/src/ops/operatorClaims.ts`（新規） | claims の付与・剥奪の計算（純関数） |
| `functions/src/ops/__tests__/grantOperator.ts`（新規） | CLI（`ops:grant`）。デプロイ対象外 |
| `functions/src/index.ts`（変更） | 4 関数の export |
| `functions/src/identity/members.ts` `gbp/templates.ts` `stores/stores.ts` `responses/responses.ts`（変更） | 利用停止の穴埋め |
| `app/utils/firebase/converters.ts` `app/composables/useFirestoreSync.ts`（変更） | claims → `isOperator` |
| `app/composables/useOps.ts` `app/pages/ops/organizations/*.vue`（変更） | 本接続・読み込み表示 |
| `docs/02-database.md` `.claude/PROJECT.md`（変更） | 資料 |

---

### Task 1: `Caller.isOperator` と `requireOperator`

**Files:**
- Modify: `functions/src/shared/auth.ts`
- Modify: `functions/src/__tests__/emulator.ts:25-27`
- Test: `functions/src/shared/__tests__/auth.test.ts`（新規）

**Interfaces:**
- Produces: `Caller { uid: string; email: string; isOperator: boolean }`、`requireOperator(caller: Caller): void`、テスト用 `operatorCaller(uid = 'u-ops'): Caller`

- [ ] **Step 1: 失敗するテストを書く** — `functions/src/shared/__tests__/auth.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallableRequest } from 'firebase-functions/https'
import { requireCaller, requireOperator } from '../auth'

const request = (token: Record<string, unknown>) => ({ auth: { uid: 'u-1', token } }) as unknown as CallableRequest<unknown>

test('requireCaller: claims の operator が true のときだけ isOperator', () => {
  assert.equal(requireCaller(request({ email: 'A@Example.com', operator: true })).isOperator, true)
  assert.equal(requireCaller(request({ operator: 'true' })).isOperator, false)
  assert.equal(requireCaller(request({})).isOperator, false)
  assert.equal(requireCaller(request({ email: 'A@Example.com' })).email, 'a@example.com')
})

test('requireOperator: 運営者でなければ permission-denied', () => {
  assert.doesNotThrow(() => requireOperator({ uid: 'u', email: '', isOperator: true }))
  assert.throws(() => requireOperator({ uid: 'u', email: '', isOperator: false }), { code: 'permission-denied', message: '運営権限がありません。' })
})
```

- [ ] **Step 2: 失敗を確認** — Run: `npm --prefix functions test` / Expected: tsc が `requireOperator` 未定義・`isOperator` 不在で失敗

- [ ] **Step 3: 実装** — `functions/src/shared/auth.ts` を次にする

```ts
import type { CallableRequest } from 'firebase-functions/https'
import { fail } from './errors'

export interface Caller {
  uid: string
  /** 小文字化済み。メール未設定のアカウントは空文字 */
  email: string
  /** Custom Claims の operator（運営者）。付与は npm run ops:grant だけ */
  isOperator: boolean
}

export function requireCaller(request: CallableRequest<unknown>): Caller {
  const auth = request.auth
  if (!auth) fail('unauthenticated', 'ログインしてください。')
  const email = typeof auth.token.email === 'string' ? auth.token.email.toLowerCase() : ''
  return { uid: auth.uid, email, isOperator: auth.token.operator === true }
}

export function requireOperator(caller: Caller): void {
  if (!caller.isOperator) fail('permission-denied', '運営権限がありません。')
}
```

`functions/src/__tests__/emulator.ts` の `caller` を次に置き換える

```ts
export function caller(uid: string, email = `${uid}@example.com`): Caller {
  return { uid, email, isOperator: false }
}

export function operatorCaller(uid = 'u-ops'): Caller {
  return { uid, email: `${uid}@example.com`, isOperator: true }
}
```

- [ ] **Step 4: 通ることを確認** — Run: `npm --prefix functions test && npm --prefix functions run build` / Expected: PASS・型エラーなし（`Caller` を組み立てているのは `requireCaller` と `caller()` だけ）

- [ ] **Step 5: 確認** — 差分を見せ、コミットしてよいかユーザーに聞く（許可があれば `git add functions/src/shared/auth.ts functions/src/shared/__tests__/auth.test.ts functions/src/__tests__/emulator.ts && git commit -m "feat(functions): Caller に運営フラグを追加"`）

---

### Task 2: 利用停止の穴埋め

**Files:**
- Modify: `functions/src/identity/members.ts`（`updateMemberRoleFunc` / `deleteMemberFunc`）
- Modify: `functions/src/gbp/templates.ts`（3 関数）
- Modify: `functions/src/stores/stores.ts`（`updateStoreArchiveFunc`）
- Modify: `functions/src/responses/responses.ts`（`postSurveyResponseFunc`）
- Test: `functions/src/identity/__tests__/members.itest.ts`・`gbp/__tests__/templates.itest.ts`・`stores/__tests__/stores.itest.ts`・`responses/__tests__/responses.itest.ts`・`google/__tests__/oauthClient.itest.ts`

**Interfaces:**
- Consumes: `requireOrg(db, orgId, tx?)`（既存。`status !== 'active'` で `failed-precondition`「この組織は利用停止中です。」）

- [ ] **Step 1: 失敗するテストを書く**（各ファイルの末尾に追加）

`identity/__tests__/members.itest.ts`

```ts
test('停止中の組織では updateMemberRole / deleteMember を拒否する', async () => {
  await db.doc('organizations/org-a').update({ status: 'suspended' })
  const SUSPENDED = { code: 'failed-precondition', message: 'この組織は利用停止中です。' }
  await assert.rejects(updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'admin', storeIds: [] }), SUSPENDED)
  await assert.rejects(deleteMemberFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-staff' }), SUSPENDED)
})
```

`gbp/__tests__/templates.itest.ts`

```ts
test('replyTemplate: 停止中の組織では作成・更新・削除を拒否する', async () => {
  const { id } = await createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'お礼', body: '本文' })
  await db.doc('organizations/org-a').update({ status: 'suspended' })
  const SUSPENDED = { code: 'failed-precondition', message: 'この組織は利用停止中です。' }
  await assert.rejects(createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'x', body: 'y' }), SUSPENDED)
  await assert.rejects(updateReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id, name: 'x', body: 'y' }), SUSPENDED)
  await assert.rejects(deleteReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id }), SUSPENDED)
})
```

`stores/__tests__/stores.itest.ts`

```ts
test('updateStoreArchive: 停止中の組織では拒否する', async () => {
  await db.doc('organizations/org-a/stores/st-111').set({ orgId: 'org-a', name: '渋谷店', status: 'active' })
  await db.doc('organizations/org-a').update({ status: 'suspended' })
  await assert.rejects(updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-111' }), { code: 'failed-precondition', message: 'この組織は利用停止中です。' })
  assert.equal((await db.doc('organizations/org-a/stores/st-111').get()).get('status'), 'active')
})
```

`responses/__tests__/responses.itest.ts`（`publicSurveys` は公開中のまま、組織だけ停止した「ずれ」の状態を作る）

```ts
test('postSurveyResponse: 組織が停止中なら受け付けない。保存済みの再送は結果を返す', async () => {
  const first = await post('sub-1', { 'q-overall': 5 })
  await db.doc(`organizations/${ORG}`).update({ status: 'suspended' })
  await assert.rejects(post('sub-2', { 'q-overall': 5 }), CLOSED)
  assert.deepEqual(await post('sub-1', { 'q-overall': 5 }), first)
  assert.equal(await responseCount(), 1)
})
```

`google/__tests__/oauthClient.itest.ts`（既存機能への影響：停止中も削除できる）

```ts
test('deleteGoogleOAuthClient: 停止中の組織でも削除できる', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 's' })
  await db.doc('organizations/org-a').update({ status: 'suspended' })
  await deleteGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a' })
  assert.equal((await db.doc('oauthClientSecrets/org-a').get()).exists, false)
})
```

- [ ] **Step 2: 失敗を確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` / Expected: 追加した members・templates・stores・responses の 4 件が FAIL（拒否されない）、oauthClient の 1 件は PASS

- [ ] **Step 3: 実装**

`identity/members.ts` — 両関数のトランザクション先頭（`requireMember` の前）に 1 行ずつ追加（`requireOrg` は import 済み）

```ts
  await db.runTransaction(async (tx) => {
    await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
```

`gbp/templates.ts` — import を `import { requireMember, requireOrg } from '../shared/members'` にし、3 関数の `await requireMember(...)` の直前に追加

```ts
  await requireOrg(db, orgId)
```

`stores/stores.ts` `updateStoreArchiveFunc` — トランザクション先頭に追加（`requireOrg` は import 済み）

```ts
  await db.runTransaction(async (tx) => {
    await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
```

`responses/responses.ts` `postSurveyResponseFunc` — 店舗の読み取りの次に組織を読み、受付判定の先頭で見る（読み取りはすべて書き込みより前）

```ts
    const store = await tx.get(db.doc(`organizations/${survey.orgId}/stores/${survey.storeId}`))
    const org = await tx.get(db.doc(`organizations/${survey.orgId}`))
```

```ts
    // 運営による利用停止。publicSurveys の停止が間に合わなかった回答もここで止める
    if (org.get('status') !== 'active') fail('failed-precondition', CLOSED_MESSAGE)
    if (survey.status !== 'published') fail('failed-precondition', CLOSED_MESSAGE)
```

- [ ] **Step 4: 通ることを確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` / Expected: 全件 PASS（既存テストを含む）

- [ ] **Step 5: 確認** — 差分を見せ、コミット可否を聞く（`fix(functions): 利用停止中の組織への書き込みと回答を拒否`）

---

### Task 3: 運営の読み取り（一覧・詳細）

**Files:**
- Create: `functions/src/ops/organizations.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/ops/__tests__/organizations.itest.ts`（新規）

**Interfaces:**
- Consumes: `requireOperator`（Task 1）、`orgRef`・`OrgDoc`・`OrgLimits`・`MemberRole`（`shared/members.ts`）、`toJstMonthKey`（`rankings/validation.ts`）
- Produces（Task 7 の画面が同じ形を使う）:

```ts
interface OpsOrganization { id: string; type: 'individual' | 'corporate'; name: string; plan: string; status: 'active' | 'suspended'; limits: OrgLimits; ownerUid: string; createdAt: string }
interface OpsOrganizationSummary { org: OpsOrganization; ownerName: string; ownerEmail: string; stores: number; members: number; hasConnectionError: boolean }
interface OpsOrganizationDetail extends OpsOrganizationSummary {
  connections: { id: string; googleEmail: string; status: 'active' | 'error' | 'revoked'; lastError: string | null }[]
  usage: { responses: number; reviewDrafts: number; rankChecks: number } | null
  memberList: { uid: string; displayName: string; email: string; role: MemberRole }[]
  storeList: { id: string; name: string; address: string; status: 'active' | 'archived' }[]
}
getOpsOrganizationsFunc(db, caller, data): Promise<OpsOrganizationSummary[]>
getOpsOrganizationFunc(db, caller, data, now = new Date()): Promise<OpsOrganizationDetail>
```

- [ ] **Step 1: 失敗するテストを書く** — `functions/src/ops/__tests__/organizations.itest.ts`

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, operatorCaller, seedOrg, seedStore } from '../../__tests__/emulator'
import { getOpsOrganizationFunc, getOpsOrganizationsFunc } from '../organizations'

const db = getTestDb()
const OPS = operatorCaller()
const DENIED = { code: 'permission-denied', message: '運営権限がありません。' }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner', email: 'owner@example.com' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedOrg(db, { orgId: 'org-b', status: 'suspended', members: [{ uid: 'u-b', role: 'owner' }] })
  await seedOrg(db, { orgId: 'org-gone', status: 'deleted', members: [{ uid: 'u-gone', role: 'owner' }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
  await db.doc('organizations/org-a/stores/st-2').set({ orgId: 'org-a', name: '新宿店', status: 'archived' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ status: 'error', googleEmail: 'g@example.com', lastError: '再連携してください' })
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', responses: 3 })
})

test('getOpsOrganizations: 退会済みを除く全組織の概要を返す', async () => {
  const list = await getOpsOrganizationsFunc(db, OPS, {})
  assert.deepEqual(list.map(item => item.org.id).sort(), ['org-a', 'org-b'])
  const a = list.find(item => item.org.id === 'org-a')!
  assert.equal(a.ownerEmail, 'owner@example.com')
  assert.equal(a.ownerName, 'u-owner')
  assert.equal(a.stores, 1)
  assert.equal(a.members, 2)
  assert.equal(a.hasConnectionError, true)
  assert.equal(typeof a.org.createdAt, 'string')
  assert.equal(list.find(item => item.org.id === 'org-b')!.hasConnectionError, false)
})

test('getOpsOrganization: 詳細を返す。今月の利用量が無ければ null、欠けた項目は 0', async () => {
  const detail = await getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, new Date('2026-10-18T03:00:00Z'))
  assert.deepEqual(detail.usage, { responses: 3, reviewDrafts: 0, rankChecks: 0 })
  assert.deepEqual(detail.connections, [{ id: 'c-1', googleEmail: 'g@example.com', status: 'error', lastError: '再連携してください' }])
  assert.equal(detail.memberList.length, 2)
  assert.deepEqual(detail.storeList.map(store => store.status).sort(), ['active', 'archived'])

  const nextMonth = await getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, new Date('2026-11-01T00:00:00Z'))
  assert.equal(nextMonth.usage, null)
})

test('運営の読み取り: 運営者以外は拒否、存在しない・退会済みは not-found', async () => {
  await assert.rejects(getOpsOrganizationsFunc(db, caller('u-owner'), {}), DENIED)
  await assert.rejects(getOpsOrganizationFunc(db, caller('u-owner'), { orgId: 'org-a' }), DENIED)
  await assert.rejects(getOpsOrganizationFunc(db, OPS, { orgId: 'org-none' }), { code: 'not-found', message: '組織が見つかりません。' })
  await assert.rejects(getOpsOrganizationFunc(db, OPS, { orgId: 'org-gone' }), { code: 'not-found' })
})
```

（`2026-11-01T00:00:00Z` は JST で 11 月 1 日 9 時 → 月キー `202611`。`2026-10-18T03:00:00Z` は `202610`）

- [ ] **Step 2: 失敗を確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` / Expected: `../organizations` が見つからず tsc で失敗

- [ ] **Step 3: 実装** — `functions/src/ops/organizations.ts`

```ts
import type { DocumentSnapshot, Firestore, Timestamp } from 'firebase-admin/firestore'
import { toJstMonthKey } from '../rankings/validation'
import { requireOperator, type Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { orgRef, type MemberRole, type OrgDoc, type OrgLimits } from '../shared/members'
import { asObject, requireId } from '../shared/validation'

// 運営画面（docs/superpowers/specs/2026-10-18-ops-console-design.md 3 章）。
// 運営者（Custom Claims の operator）だけが呼べる。運営者は組織のメンバーではないため requireMember / requireOrg は使わない

export interface OpsOrganization {
  id: string
  type: OrgDoc['type']
  name: string
  plan: string
  status: 'active' | 'suspended'
  limits: OrgLimits
  ownerUid: string
  createdAt: string
}

export interface OpsOrganizationSummary {
  org: OpsOrganization
  ownerName: string
  ownerEmail: string
  stores: number
  members: number
  hasConnectionError: boolean
}

export interface OpsOrganizationDetail extends OpsOrganizationSummary {
  connections: { id: string; googleEmail: string; status: 'active' | 'error' | 'revoked'; lastError: string | null }[]
  usage: { responses: number; reviewDrafts: number; rankChecks: number } | null
  memberList: { uid: string; displayName: string; email: string; role: MemberRole }[]
  storeList: { id: string; name: string; address: string; status: 'active' | 'archived' }[]
}

/** 退会済み（deleted）と存在しない組織は、運営画面でも見つからない扱い */
export function isVisibleOrg(snapshot: DocumentSnapshot): boolean {
  return snapshot.exists && snapshot.get('status') !== 'deleted'
}

function toIso(value: unknown): string {
  const timestamp = value as Timestamp | undefined
  return typeof timestamp?.toDate === 'function' ? timestamp.toDate().toISOString() : new Date(0).toISOString()
}

function toOpsOrganization(snapshot: DocumentSnapshot): OpsOrganization {
  const data = snapshot.data() as OrgDoc & { createdAt?: Timestamp }
  return {
    id: snapshot.id,
    type: data.type,
    name: data.name,
    plan: data.plan,
    status: data.status === 'suspended' ? 'suspended' : 'active',
    limits: data.limits,
    ownerUid: data.ownerUid,
    createdAt: toIso(data.createdAt),
  }
}

async function summarize(db: Firestore, snapshot: DocumentSnapshot): Promise<OpsOrganizationSummary> {
  const org = toOpsOrganization(snapshot)
  const base = orgRef(db, org.id)
  const [owner, stores, members, errors] = await Promise.all([
    base.collection('members').doc(org.ownerUid).get(),
    base.collection('stores').where('status', '==', 'active').count().get(),
    base.collection('members').count().get(),
    base.collection('googleConnections').where('status', '==', 'error').limit(1).get(),
  ])
  return {
    org,
    ownerName: owner.get('displayName') ?? '—',
    ownerEmail: owner.get('email') ?? '—',
    stores: stores.data().count,
    members: members.data().count,
    hasConnectionError: !errors.empty,
  }
}

export async function getOpsOrganizationsFunc(db: Firestore, caller: Caller, _data: unknown): Promise<OpsOrganizationSummary[]> {
  requireOperator(caller)
  const snapshot = await db.collection('organizations').where('status', 'in', ['active', 'suspended']).get()
  const list = await Promise.all(snapshot.docs.map(doc => summarize(db, doc)))
  return list.sort((a, b) => b.org.createdAt.localeCompare(a.org.createdAt))
}

export async function getOpsOrganizationFunc(db: Firestore, caller: Caller, data: unknown, now = new Date()): Promise<OpsOrganizationDetail> {
  requireOperator(caller)
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  const snapshot = await orgRef(db, orgId).get()
  if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
  const base = snapshot.ref
  const [summary, connections, usage, members, stores] = await Promise.all([
    summarize(db, snapshot),
    base.collection('googleConnections').get(),
    base.collection('usageMonthly').doc(toJstMonthKey(now)).get(),
    base.collection('members').get(),
    base.collection('stores').get(),
  ])
  return {
    ...summary,
    // トークン・秘密は oauthTokens 側にあり、ここには含まれない。念のため表示に使う項目だけを返す
    connections: connections.docs.map(doc => ({ id: doc.id, googleEmail: doc.get('googleEmail') ?? '', status: doc.get('status'), lastError: doc.get('lastError') ?? null })),
    usage: usage.exists
      ? { responses: usage.get('responses') ?? 0, reviewDrafts: usage.get('reviewDrafts') ?? 0, rankChecks: usage.get('rankChecks') ?? 0 }
      : null,
    memberList: members.docs.map(doc => ({ uid: doc.get('uid'), displayName: doc.get('displayName'), email: doc.get('email'), role: doc.get('role') })),
    storeList: stores.docs.map(doc => ({ id: doc.id, name: doc.get('name'), address: doc.get('address') ?? '', status: doc.get('status') })),
  }
}
```

`functions/src/index.ts` — import 群の末尾に追加

```ts
import { getOpsOrganizationFunc, getOpsOrganizationsFunc } from "./ops/organizations";
```

ファイル末尾に追加

```ts
// ops/ … 運営画面（F-20。Custom Claims の operator だけ。docs/superpowers/specs/2026-10-18-ops-console-design.md）
export const getOpsOrganizations = callable(getOpsOrganizationsFunc);
export const getOpsOrganization = callable((db, caller, data) => getOpsOrganizationFunc(db, caller, data));
```

- [ ] **Step 4: 通ることを確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator && npm --prefix functions run build` / Expected: PASS・型エラーなし

- [ ] **Step 5: 確認** — 差分を見せ、コミット可否を聞く（`feat(functions): 運営画面の組織一覧・詳細の callable`）

---

### Task 4: 運営の書き込み（利用停止 / 再開・プラン変更）

**Files:**
- Modify: `functions/src/ops/organizations.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/ops/__tests__/organizations.itest.ts`

**Interfaces:**
- Consumes: `isVisibleOrg`（Task 3）、`writeAuditLog(tx, db, orgId, action, actorUid, payload)`、`surveysOf(db, orgId)`（`surveys/publicSurvey.ts`）
- Produces: `updateOrganizationStatusFunc(db, caller, { orgId, status: 'active' | 'suspended' }): Promise<void>`、`updateOrganizationPlanFunc(db, caller, { orgId, plan, limits }): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く** — `organizations.itest.ts` の import を差し替え、末尾に追加

```ts
import { sampleContent } from '../../surveys/__tests__/sampleContent'
import { createSurveyFunc, updateSurveyPublishFunc, updateSurveyStatusFunc } from '../../surveys/surveys'
import { getOpsOrganizationFunc, getOpsOrganizationsFunc, updateOrganizationPlanFunc, updateOrganizationStatusFunc } from '../organizations'
```

```ts
const OWNER = caller('u-owner')
const LIMITS = { maxStores: 3, maxSurveys: 5, maxKeywords: 10, maxMembers: 4, monthlyReviewDrafts: 0, monthlyRankChecks: 100 }

async function publishSurvey(title: string): Promise<{ surveyId: string; slug: string }> {
  const { id } = await createSurveyFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', title, content: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, { orgId: 'org-a', surveyId: id })
  return { surveyId: id, slug: (await db.doc(`organizations/org-a/surveys/${id}`).get()).get('publicSlug') }
}
const publicStatus = async (slug: string) => (await db.doc(`publicSurveys/${slug}`).get()).get('status')
const auditActions = async () => (await db.collection('organizations/org-a/auditLogs').get()).docs.map(doc => doc.get('action'))

test('updateOrganizationStatus: 停止で公開アンケートを止め、再開で公開中だったものだけ戻す', async () => {
  const open = await publishSurvey('公開中')
  const paused = await publishSurvey('一時停止中')
  await updateSurveyStatusFunc(db, OWNER, { orgId: 'org-a', surveyId: paused.surveyId, action: 'pause' })

  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'suspended' })
  assert.equal((await db.doc('organizations/org-a').get()).get('status'), 'suspended')
  assert.equal(await publicStatus(open.slug), 'paused')
  assert.equal(await publicStatus(paused.slug), 'paused')

  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'active' })
  assert.equal(await publicStatus(open.slug), 'published')
  assert.equal(await publicStatus(paused.slug), 'paused')

  const logs = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'ops.updateOrganizationStatus').get()).docs.map(doc => doc.data())
  assert.equal(logs.length, 2)
  assert.ok(logs.every(log => log.actorUid === 'u-ops'))
  assert.deepEqual(logs.map(log => log.payload).sort((a, b) => a.to.localeCompare(b.to)), [{ from: 'suspended', to: 'active' }, { from: 'active', to: 'suspended' }])
})

test('updateOrganizationStatus: 同じ状態への変更は何もしない（監査ログも書かない）', async () => {
  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'active' })
  assert.deepEqual((await auditActions()).filter(action => action.startsWith('ops.')), [])
})

test('updateOrganizationPlan: プラン名と上限を変え、変更前の値を監査ログに残す。上限 0 は可', async () => {
  await updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: ' ライト ', limits: LIMITS })
  const org = (await db.doc('organizations/org-a').get()).data()!
  assert.equal(org.plan, 'ライト')
  assert.deepEqual(org.limits, LIMITS)
  const log = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'ops.updateOrganizationPlan').get()).docs[0]!.data()
  assert.equal(log.payload.before.plan, 'ビジネス')
  assert.deepEqual(log.payload.limits, LIMITS)
})

test('updateOrganizationPlan: 上限・プラン名の不正値を拒否する', async () => {
  const INVALID_LIMIT = { code: 'invalid-argument', message: '上限値は 0 以上の整数で入力してください。' }
  for (const bad of [-1, 1.5, '3', null]) {
    await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'ライト', limits: { ...LIMITS, maxStores: bad } }), INVALID_LIMIT)
  }
  const { maxMembers: _omitted, ...missing } = LIMITS
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'ライト', limits: missing }), INVALID_LIMIT)
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: '', limits: LIMITS }), { code: 'invalid-argument', message: 'プラン名を入力してください。' })
  await updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'あ'.repeat(50), limits: LIMITS })
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'あ'.repeat(51), limits: LIMITS }), { code: 'invalid-argument', message: 'プラン名は 50 文字以内にしてください。' })
})

test('運営の書き込み: 運営者以外は拒否、退会済み・存在しない組織は not-found、不正な状態は拒否', async () => {
  await assert.rejects(updateOrganizationStatusFunc(db, OWNER, { orgId: 'org-a', status: 'suspended' }), DENIED)
  await assert.rejects(updateOrganizationPlanFunc(db, OWNER, { orgId: 'org-a', plan: 'x', limits: LIMITS }), DENIED)
  await assert.rejects(updateOrganizationStatusFunc(db, OPS, { orgId: 'org-gone', status: 'active' }), { code: 'not-found' })
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-none', plan: 'x', limits: LIMITS }), { code: 'not-found' })
  await assert.rejects(updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'deleted' }), { code: 'invalid-argument' })
  assert.equal((await db.doc('organizations/org-a').get()).get('status'), 'active')
})
```

- [ ] **Step 2: 失敗を確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` / Expected: `updateOrganizationStatusFunc` 未 export で tsc が失敗

- [ ] **Step 3: 実装** — `functions/src/ops/organizations.ts` の import を差し替え、末尾に追加

```ts
import type { DocumentSnapshot, Firestore, Timestamp } from 'firebase-admin/firestore'
import { toJstMonthKey } from '../rankings/validation'
import { writeAuditLog } from '../shared/audit'
import { requireOperator, type Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { orgRef, type MemberRole, type OrgDoc, type OrgLimits } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { surveysOf } from '../surveys/publicSurvey'
```

```ts
const SETTABLE_STATUSES = ['active', 'suspended'] as const
const LIMIT_KEYS = ['maxStores', 'maxSurveys', 'maxKeywords', 'maxMembers', 'monthlyReviewDrafts', 'monthlyRankChecks'] as const satisfies readonly (keyof OrgLimits)[]

function requireLimits(value: unknown): OrgLimits {
  const input = asObject(value)
  const limits = {} as OrgLimits
  for (const key of LIMIT_KEYS) {
    const item = input[key]
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) fail('invalid-argument', '上限値は 0 以上の整数で入力してください。')
    limits[key] = item
  }
  return limits
}

/**
 * 利用停止 / 再開。同じトランザクションで回答画面の公開データ（publicSurveys）をそろえる。
 * 再開時の戻し先は停止前の値を持たず、その都度 surveys の status から導く（停止中の変更とずれないように）
 */
export async function updateOrganizationStatusFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  requireOperator(caller)
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const status = requireOneOf(input.status, SETTABLE_STATUSES, '状態')

  await db.runTransaction(async (tx) => {
    const ref = orgRef(db, orgId)
    const snapshot = await tx.get(ref)
    if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
    const from = snapshot.get('status')
    if (from === status) return
    const publicSurveys = await tx.get(db.collection('publicSurveys').where('orgId', '==', orgId))
    const surveys = await Promise.all(publicSurveys.docs.map(doc => tx.get(surveysOf(db, orgId).doc(doc.get('surveyId')))))

    tx.update(ref, { status })
    publicSurveys.docs.forEach((doc, index) => {
      const isPublished = status === 'active' && surveys[index]?.get('status') === 'published'
      tx.update(doc.ref, { status: isPublished ? 'published' : 'paused' })
    })
    writeAuditLog(tx, db, orgId, 'ops.updateOrganizationStatus', caller.uid, { from, to: status })
  })
}

export async function updateOrganizationPlanFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  requireOperator(caller)
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const plan = requireString(input.plan, 'プラン名', 50)
  const limits = requireLimits(input.limits)

  await db.runTransaction(async (tx) => {
    const ref = orgRef(db, orgId)
    const snapshot = await tx.get(ref)
    if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
    tx.update(ref, { plan, limits })
    writeAuditLog(tx, db, orgId, 'ops.updateOrganizationPlan', caller.uid, {
      plan,
      limits,
      before: { plan: snapshot.get('plan'), limits: snapshot.get('limits') },
    })
  })
}
```

`functions/src/index.ts` — import を差し替え、ops の export に 2 行追加

```ts
import { getOpsOrganizationFunc, getOpsOrganizationsFunc, updateOrganizationPlanFunc, updateOrganizationStatusFunc } from "./ops/organizations";
```

```ts
export const updateOrganizationStatus = callable(updateOrganizationStatusFunc);
export const updateOrganizationPlan = callable(updateOrganizationPlanFunc);
```

- [ ] **Step 4: 通ることを確認** — Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator && npm --prefix functions run build` / Expected: PASS・型エラーなし

- [ ] **Step 5: 確認** — 差分を見せ、コミット可否を聞く（`feat(functions): 運営による利用停止・再開とプラン変更`）

---

### Task 5: 権限付与の CLI（`ops:grant`）

**Files:**
- Create: `functions/src/ops/operatorClaims.ts`
- Create: `functions/src/ops/__tests__/grantOperator.ts`
- Modify: `functions/package.json`（scripts）
- Test: `functions/src/ops/__tests__/operatorClaims.test.ts`（新規）

**Interfaces:**
- Produces: `nextOperatorClaims(current: Record<string, unknown> | undefined, isRevoke: boolean): Record<string, unknown>`

- [ ] **Step 1: 失敗するテストを書く** — `functions/src/ops/__tests__/operatorClaims.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextOperatorClaims } from '../operatorClaims'

test('nextOperatorClaims: 既存の claims を保ったまま operator を付け外しする', () => {
  assert.deepEqual(nextOperatorClaims(undefined, false), { operator: true })
  assert.deepEqual(nextOperatorClaims({ plan: 'x' }, false), { plan: 'x', operator: true })
  assert.deepEqual(nextOperatorClaims({ plan: 'x', operator: true }, true), { plan: 'x' })
  assert.deepEqual(nextOperatorClaims(undefined, true), {})
})
```

- [ ] **Step 2: 失敗を確認** — Run: `npm --prefix functions test` / Expected: `../operatorClaims` が見つからず失敗

- [ ] **Step 3: 実装**

`functions/src/ops/operatorClaims.ts`

```ts
/** 運営者の付与・剥奪後の Custom Claims。operator 以外の claims は保つ */
export function nextOperatorClaims(current: Record<string, unknown> | undefined, isRevoke: boolean): Record<string, unknown> {
  const { operator: _operator, ...rest } = current ?? {}
  return isRevoke ? rest : { ...rest, operator: true }
}
```

`functions/src/ops/__tests__/grantOperator.ts`

```ts
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { nextOperatorClaims } from '../operatorClaims'

// 運営者（Custom Claims の operator）の付与・剥奪。本番の Auth / Firestore に書き込む（デプロイ対象外）
// 使い方: npm --prefix functions run ops:grant -- <email> [--revoke]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const email = args.find(arg => !arg.startsWith('--'))
  const isRevoke = args.includes('--revoke')
  if (!email) {
    console.error('使い方: npm --prefix functions run ops:grant -- <email> [--revoke]')
    process.exit(1)
  }
  // lib-test/ops/__tests__/ から functions/serviceAccount.json を読む
  const serviceAccount = require('../../../serviceAccount.json')
  initializeApp({ credential: cert(serviceAccount as ServiceAccount) })
  const auth = getAuth()
  const user = await auth.getUserByEmail(email)
  await auth.setCustomUserClaims(user.uid, nextOperatorClaims(user.customClaims, isRevoke))
  // platformRole は表示用の写し。判定は claims で行う
  await getFirestore().doc(`users/${user.uid}`).set({ platformRole: isRevoke ? null : 'operator' }, { merge: true })
  if (isRevoke) await auth.revokeRefreshTokens(user.uid)
  console.log(`${email}（${user.uid}）の運営権限を${isRevoke ? '外しました。既存のログインも無効にしました' : '付けました'}。`)
  console.log('対象者は一度ログアウトして、ログインし直してください（権限は ID トークンの再取得で反映されます）。')
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
```

`functions/package.json` の `scripts` に追加（`rank:probe` の次）

```json
    "ops:grant": "tsc -p tsconfig.test.json && node lib-test/ops/__tests__/grantOperator.js",
```

- [ ] **Step 4: 通ることを確認** — Run: `npm --prefix functions test && npm --prefix functions run build` / Expected: PASS（`__tests__` は `tsconfig.json` のビルドに含まれず、デプロイされない）。引数なしの `npm --prefix functions run ops:grant` で使い方が出て終了コード 1 になること

- [ ] **Step 5: 確認** — 差分を見せ、コミット可否を聞く（`feat(functions): 運営者を付与・剥奪する ops:grant`）。**本番ユーザーへの実行はユーザーが行う**（このタスクでは実行しない）

---

### Task 6: 画面で claims から `isOperator` を読む

**Files:**
- Modify: `app/utils/firebase/converters.ts:17-24`
- Modify: `app/composables/useFirestoreSync.ts:58-63`・`:230-240`

**Interfaces:**
- Produces: `toUser(authUser: AuthUser, claims?: Record<string, unknown>): User`

- [ ] **Step 1: 実装** — `converters.ts`

```ts
export function toUser(authUser: AuthUser, claims: Record<string, unknown> = {}): User {
  return {
    uid: authUser.uid,
    email: (authUser.email ?? '').toLowerCase(),
    displayName: authUser.displayName ?? authUser.email ?? '',
    // 運営フラグは Custom Claims（functions の npm run ops:grant で付与）
    isOperator: claims.operator === true,
  }
}
```

`useFirestoreSync.ts` の `refreshAuthUser`

```ts
export function refreshAuthUser(): void {
  const { $auth } = useNuxtApp()
  const db = useFirestoreDb()
  if (!$auth.currentUser) return
  // claims は変わらないので、運営フラグは今の値を引き継ぐ
  db.value.users = [{ ...toUser($auth.currentUser), isOperator: db.value.users[0]?.isOperator ?? false }]
}
```

`startFirestoreSync` の `onAuthStateChanged`

```ts
  onAuthStateChanged($auth, async (authUser) => {
    resetAll()
    state.value.isOrgsReady = false
    if (!authUser) {
      state.value.isAuthReady = true
      state.value.isOrgsReady = true
      return
    }
    // claims（運営フラグ）を読むまで認証済みにしない。ops.global.ts が isOperator を見るため
    state.value.isAuthReady = false
    const claims = await authUser.getIdTokenResult().then(result => result.claims, () => ({}))
    // 待つ間に別のユーザーへ切り替わっていたら、新しい方の通知に任せる
    if ($auth.currentUser?.uid !== authUser.uid) return
    db.value.users = [toUser(authUser, claims)]
    state.value.isAuthReady = true
    watchMemberships(authUser.uid)
  })
```

- [ ] **Step 2: 型を確認** — Run: `npm run typecheck`（ルート）/ Expected: エラーなし

- [ ] **Step 3: 確認** — 差分を見せ、コミット可否を聞く（`feat(app): Custom Claims から運営フラグを読む`）

---

### Task 7: `useOps` の本接続と運営画面の読み込み表示

**Files:**
- Modify: `app/composables/useOps.ts`
- Modify: `app/pages/ops/organizations/index.vue`
- Modify: `app/pages/ops/organizations/[orgId].vue`

**Interfaces:**
- Consumes: callable `getOpsOrganizations` / `getOpsOrganization` / `updateOrganizationStatus` / `updateOrganizationPlan`（Task 3・4。戻り値の形は Task 3 の Interfaces と同じ）、`callFunction`（`~/utils/firebase/callFunction`）
- Produces: `useOps(): { fetchOrganizations(): Promise<OpsOrganizationSummary[]>; fetchOrganization(orgId): Promise<OpsOrganizationDetail | null>; updateStatus(orgId, status): Promise<void>; updatePlan(orgId, plan, limits): Promise<void> }`

- [ ] **Step 1: `useOps.ts` を置き換える**

```ts
import type { GoogleConnection, Member, OrgLimits, OrgStatus, Organization, Store, UsageMonthly } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { toMonthKey } from '~/utils/format'
import { updateOrganizationPlanFunc, updateOrganizationStatusFunc } from '~/utils/mock/functions/ops'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-20 運営管理（全組織の横断）。本接続は functions/src/ops/organizations.ts の callable

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  active: '利用中',
  suspended: '利用停止',
  deleted: '退会済み',
}

export type OpsOrganization = Pick<Organization, 'id' | 'type' | 'name' | 'plan' | 'status' | 'limits' | 'ownerUid' | 'createdAt'>

export interface OpsOrganizationSummary {
  org: OpsOrganization
  ownerName: string
  ownerEmail: string
  stores: number
  members: number
  hasConnectionError: boolean
}

export interface OpsOrganizationDetail extends OpsOrganizationSummary {
  connections: Pick<GoogleConnection, 'id' | 'googleEmail' | 'status' | 'lastError'>[]
  usage: Pick<UsageMonthly, 'responses' | 'reviewDrafts' | 'rankChecks'> | null
  memberList: Pick<Member, 'uid' | 'displayName' | 'email' | 'role'>[]
  storeList: Pick<Store, 'id' | 'name' | 'address' | 'status'>[]
}

export function useOps() {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useMockDb()
  const { user } = useAuth()

  function mockSummary(org: Organization): OpsOrganizationSummary {
    const owner = db.value.users.find(item => item.uid === org.ownerUid)
    return {
      org,
      ownerName: owner?.displayName ?? '—',
      ownerEmail: owner?.email ?? '—',
      stores: db.value.stores.filter(item => item.orgId === org.id && item.status === 'active').length,
      members: db.value.members.filter(item => item.orgId === org.id).length,
      hasConnectionError: db.value.googleConnections.some(item => item.orgId === org.id && item.status === 'error'),
    }
  }

  async function fetchOrganizations(): Promise<OpsOrganizationSummary[]> {
    if (!isMock.value) return callFunction($functions, 'getOpsOrganizations', {})
    await mockLatency()
    return db.value.organizations.filter(org => org.status !== 'deleted').map(mockSummary)
  }

  async function fetchOrganization(orgId: string): Promise<OpsOrganizationDetail | null> {
    if (!isMock.value) return callFunction($functions, 'getOpsOrganization', { orgId })
    await mockLatency()
    const org = db.value.organizations.find(item => item.id === orgId && item.status !== 'deleted')
    if (!org) return null
    return {
      ...mockSummary(org),
      connections: db.value.googleConnections.filter(item => item.orgId === orgId),
      usage: db.value.usage.find(item => item.orgId === orgId && item.month === toMonthKey(new Date())) ?? null,
      memberList: db.value.members.filter(item => item.orgId === orgId),
      storeList: db.value.stores.filter(item => item.orgId === orgId),
    }
  }

  async function updateStatus(orgId: string, status: Exclude<OrgStatus, 'deleted'>): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateOrganizationStatus', { orgId, status })
      return
    }
    await mockLatency()
    updateOrganizationStatusFunc(db.value, user.value!.uid, orgId, status)
  }

  async function updatePlan(orgId: string, plan: string, limits: OrgLimits): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateOrganizationPlan', { orgId, plan, limits })
      return
    }
    await mockLatency()
    updateOrganizationPlanFunc(db.value, user.value!.uid, orgId, plan, limits)
  }

  return { fetchOrganizations, fetchOrganization, updateStatus, updatePlan }
}
```

- [ ] **Step 2: 一覧ページ** — `index.vue` の `<script setup>` の `const { organizations } = useOps()` を次に置き換える

```ts
import type { OpsOrganizationSummary } from '~/composables/useOps'
```

（上の import は既存の `import type { OrgStatus, OrgType } ...` の次の行に置く）

```ts
const { fetchOrganizations } = useOps()
const organizations = ref<OpsOrganizationSummary[]>([])
const loadState = useActionState()
// 一覧は開いたときに 1 回だけ読む（購読しない）
onMounted(async () => {
  organizations.value = (await loadState.run(fetchOrganizations)) ?? []
})
```

テンプレートの `<UiCommonPageHeader ... />` の直後に追加

```vue
    <UiCommonAlert v-if="loadState.errorMessage.value" tone="danger" class="mb-4">{{ loadState.errorMessage.value }}</UiCommonAlert>
```

`<tr v-if="filtered.length === 0">` の行を次にする（読み込み中は「該当なし」と出さない）

```vue
            <tr v-if="filtered.length === 0">
              <td colspan="7" class="px-4 py-10 text-center text-slate-500">{{ loadState.isPending.value ? '読み込み中…' : '条件に合う組織がありません。' }}</td>
            </tr>
```

- [ ] **Step 3: 詳細ページ** — `[orgId].vue` の `<script setup>` を次にする

```ts
import type { OrgLimits } from '~/types/domain'
import type { OpsOrganizationDetail } from '~/composables/useOps'

definePageMeta({ layout: 'ops' })
useSeoMeta({ title: '組織詳細（運営）', robots: 'noindex, nofollow' })

const route = useRoute()
const orgId = String(route.params.orgId)
const { fetchOrganization, updateStatus, updatePlan } = useOps()
const detail = ref<OpsOrganizationDetail | null>(null)
const { show } = useToast()
const loadState = useActionState()
const statusAction = useActionState()
const planAction = useActionState()

const LIMIT_FIELDS: { key: keyof OrgLimits; label: string }[] = [
  { key: 'maxStores', label: '店舗数' },
  { key: 'maxSurveys', label: 'アンケート数' },
  { key: 'maxKeywords', label: '順位キーワード数' },
  { key: 'maxMembers', label: 'メンバー数' },
  { key: 'monthlyReviewDrafts', label: '口コミ生成（月）' },
  { key: 'monthlyRankChecks', label: '順位計測（月）' },
]

// 入力は文字列で持ち、保存時に数値へ変換する
const plan = ref('')
const limitInputs = ref<Record<keyof OrgLimits, string>>({
  maxStores: '', maxSurveys: '', maxKeywords: '', maxMembers: '', monthlyReviewDrafts: '', monthlyRankChecks: '',
})

function resetForm(): void {
  if (!detail.value) return
  plan.value = detail.value.org.plan
  for (const field of LIMIT_FIELDS) limitInputs.value[field.key] = String(detail.value.org.limits[field.key])
}

async function load(): Promise<void> {
  detail.value = (await loadState.run(() => fetchOrganization(orgId))) ?? null
  resetForm()
}
onMounted(load)

const isSuspended = computed(() => detail.value?.org.status === 'suspended')

async function onToggleStatus(): Promise<void> {
  const next = isSuspended.value ? 'active' : 'suspended'
  const isDone = await statusAction.run(async () => {
    await updateStatus(orgId, next)
    return true
  })
  if (!isDone) return
  show(next === 'active' ? '利用を再開しました' : '利用を停止しました')
  await load()
}

/** 空欄は 0 にせず不正な値（NaN → JSON では null）として送り、サーバーに拒否させる */
function toLimitValue(input: string): number {
  return input.trim() === '' ? Number.NaN : Number(input)
}

async function onSavePlan(): Promise<void> {
  const limits = Object.fromEntries(LIMIT_FIELDS.map(field => [field.key, toLimitValue(limitInputs.value[field.key])])) as unknown as OrgLimits
  const isDone = await planAction.run(async () => {
    await updatePlan(orgId, plan.value.trim(), limits)
    return true
  })
  if (!isDone) return
  show('プランと上限を更新しました')
  await load()
}
```

テンプレート先頭の `<div v-if="!detail" class="space-y-4">` ブロックを次にする

```vue
  <p v-if="loadState.isPending.value && !detail" class="text-sm text-slate-500">読み込み中…</p>

  <div v-else-if="!detail" class="space-y-4">
    <UiCommonAlert tone="danger">{{ loadState.errorMessage.value ?? '組織が見つかりません。' }}</UiCommonAlert>
    <UiCommonButton to="/ops/organizations" variant="secondary">組織一覧へ</UiCommonButton>
  </div>
```

（後続の `<div v-else class="space-y-6">` はそのまま）

モックの `updateOrganizationPlanFunc` は `Number.isInteger(NaN)` が false のため、デモでも空欄は「上限値は 0 以上の整数で入力してください。」になる。

- [ ] **Step 4: 型を確認** — Run: `npm run typecheck`（ルート）/ Expected: エラーなし

- [ ] **Step 5: 画面で確認（デモ）** — `npm run dev` を起動し、デモアカウントでは `/ops/organizations` が 404 のままであること（デモに運営アカウントはない）、管理画面が従来どおり表示されることを確認する

- [ ] **Step 6: 画面で確認（本接続）** — ユーザーに次を依頼する（本番の Auth に書き込むため、実行はユーザーの判断）
  1. 別ターミナルで `npm --prefix functions run serve`
  2. 確認用アカウントに `npm --prefix functions run ops:grant -- <確認用メール>`
  3. 再ログイン → `/orgs` に運営リンクが出る → 一覧・詳細が表示される
  4. **確認用の組織だけで**停止 → 公開アンケートが受付停止になる → 再開、プランの保存、上限を空欄にしての保存がエラーになること

- [ ] **Step 7: 確認** — 差分を見せ、コミット可否を聞く（`feat(app): 運営画面を本接続`）

---

### Task 8: 資料の更新

**Files:**
- Modify: `docs/02-database.md`（ルール表の「すべて」の行）
- Modify: `docs/04-features.md`（F-20 の表に「データ取得」行）
- Modify: `.claude/PROJECT.md`（「モード」の運営画面の記述・`FIREBASE_READY_PATHS` の記述・Functions のフォルダ・npm scripts）
- Modify: `docs/superpowers/specs/2026-10-18-ops-console-design.md`（状態）

- [ ] **Step 1: `docs/02-database.md`** — 次の行を

```
| すべて | 運営（`request.auth.token.operator == true`）は読取可 | — |
```

次に置き換える

```
| すべて | 運営は Firestore を直接読まない。運営専用の callable（`getOpsOrganizations` / `getOpsOrganization`）を使う（`docs/superpowers/specs/2026-10-18-ops-console-design.md`） | — |
```

- [ ] **Step 2: `docs/04-features.md`** — F-20 の表の「権限」行の次に追加

```
| データ取得 | 運営専用の callable（`functions/src/ops/organizations.ts`）。Firestore ルールは運営者に広げない |
| 利用停止の効果 | 書き込み系の callable・公開アンケートの受付・自動同期 / 自動計測を止める。閲覧・CSV・Google 連携の解除は可 |
```

- [ ] **Step 3: `.claude/PROJECT.md`**
  - 「モード」の「仮データ内のそれ以外のユーザー（運営の `u-ops` など）ではログインできない。運営画面の本接続は未着手」を「仮データ内のそれ以外のユーザー（運営の `u-ops` など）ではログインできない。運営画面（`/ops`）は本接続のみ。運営者は Custom Claims `operator: true`（`npm --prefix functions run ops:grant -- <email> [--revoke]`。本番の Auth に書き込む。付与後は再ログインが必要）」にする
  - 「本接続済みの画面は `app/composables/useAdminNav.ts` の `FIREBASE_READY_PATHS`。接続した画面を増やしたらここに足す」の行を削除する（実物に無い。切り替えは各 composable の `isMock` 分岐）
  - 「Functions」表の「フォルダ」に「`ops/`（運営画面。Custom Claims の operator だけが呼べる）」を足す
  - 「npm scripts」表に `| functions | npm run ops:grant -- <email> [--revoke] | 運営者の付与・剥奪（本番の Auth / Firestore に書き込む。剥奪時は既存のログインも無効にする） |` を足す

- [ ] **Step 4: 設計書の状態** — `- 状態: 設計（未実装）` を `- 状態: 実装済み（2026-10-18）` にする

- [ ] **Step 5: 最終確認** — Run: `npm run typecheck && npm --prefix functions test && npm --prefix functions run build && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` / Expected: すべて PASS。差分を見せ、コミット可否を聞く（`docs: 運営画面の本接続を反映`）
