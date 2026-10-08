# 基盤（認証・組織・メンバー・ルール）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面の「認証・組織・メンバー招待・権限」を Firebase（Auth / Firestore / Functions）に本接続し、環境変数で「全部モック」と「基盤は本物」を切り替えられるようにする。

**Architecture:** 書き込みはすべて callable Functions（`identity/`）。読み取りはクライアントが Firestore を `onSnapshot` で購読し、モックと**同じ形のリアクティブ DB**（`MockDb`）に流し込む。これにより既存 composable の `computed` とミドルウェアは読み取り側を変えずに動き、切り替えるのは書き込み関数だけになる。本物モードでまだ接続していない画面は、admin レイアウトが「準備中」を表示する。

**Tech Stack:** Nuxt 4（SPA）/ Firebase JS SDK 12 / firebase-functions 7（v2 onCall）/ firebase-admin 13 / Firestore Emulator（Java 21）/ `node:test` / `@firebase/rules-unit-testing` 5

**Spec:** `docs/superpowers/specs/2026-10-07-gbp-integration-design.md`（3 章）

## Global Constraints

- Functions の region は `asia-northeast1`（`setGlobalOptions`）。既存の `initializeApp`（serviceAccount）と `Hellow` は変更しない
- 書き込みはすべて callable。callable の export 名はハンドラー名から `Func` を除いたもの（`createOrganizationFunc` → `createOrganization`）
- ハンドラーは `(db: Firestore, caller: Caller, data: unknown) => Promise<T>` の形にし、Emulator 上で直接テストする
- エラーは `HttpsError`。コードとメッセージはモック（`app/utils/mock/functions/identity.ts`）と同じ日本語メッセージにそろえる
- 招待トークンは平文を保存しない（`tokenHash` = SHA-256 hex）。平文は作成時の応答でのみ返す
- 環境変数: `NUXT_PUBLIC_USE_MOCK`（既定 `true`。`false` で本物）、`NUXT_PUBLIC_USE_EMULATOR`（`true` で Emulator 接続）
- 本物モードで動く管理画面は `/settings/organization` と `/settings/members` のみ。他は「準備中」
- テスト用 Emulator のプロジェクト ID は `demo-meo-tool`（実リソースに触れない `demo-` 接頭辞）
- Emulator は Java 21 が必要。このマシンでは `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` を付けて実行する
- `NUXT_PUBLIC_USE_MOCK=true`（既定）で現行の全画面がそのまま動くこと
- コミットはユーザーの許可がある場合のみ（現状の方針: その場で実装・コミットなし）

## Review Focus

- **同じリクエストの再送（二度押し・タイムアウト後の再送）で組織が 2 つできない**: `createOrganization` は同じ `requestId` なら同じ `orgId` を返す → Task 2 のテスト
- **期限切れの招待**: `status` は `pending` のままでも期限切れなら受諾・取消・人数カウントの対象外 → Task 3 のテスト
- **メールアドレスの大文字小文字違い**（`Tanaka@Example.com` で招待し `tanaka@example.com` でログイン）: 同一として扱う → Task 3 のテスト
- **作成直後の画面遷移**（新規登録・招待受諾の直後に `/admin/{orgId}` へ移動）: Firestore の購読が届く前にミドルウェアが「メンバーでない」と判定して `/orgs` へ飛ばさない → Task 7 の `waitForOrg` と Task 9 の E2E
- **staff の店舗読み取り**: 担当店舗だけを `documentId() in [...]` で読めて、担当外は読めない → Task 5 のルールテスト

---

## File Structure

### Functions

| ファイル | 責務 |
| --- | --- |
| `functions/src/shared/errors.ts` | `fail(code, message): never`（`HttpsError` を投げる） |
| `functions/src/shared/auth.ts` | `Caller` 型と `requireCaller(request)` |
| `functions/src/shared/validation.ts` | 入力検証（`asObject` / `requireString` / `requireId` / `requireOneOf` / `requireStringArray` / `requireEmail`） |
| `functions/src/shared/members.ts` | Firestore の型・参照と権限ガード（`requireOrg` / `requireMember` / `requireStoreAccess`） |
| `functions/src/shared/audit.ts` | `writeAuditLog(tx, db, orgId, action, actorUid, payload)` |
| `functions/src/shared/callable.ts` | `callable(handler)` / `publicCallable(handler)`（onCall の薄いラッパー） |
| `functions/src/identity/limits.ts` | プラン既定値（モックと同値） |
| `functions/src/identity/createOrganization.ts` | `createOrganizationFunc` |
| `functions/src/identity/invitations.ts` | `createInvitationFunc` / `getInvitationFunc` / `updateInvitationAcceptFunc` / `updateInvitationRevokeFunc` / `hashToken` |
| `functions/src/identity/members.ts` | `updateMemberRoleFunc` / `deleteMemberFunc` / `updateOrganizationNameFunc` |
| `functions/src/index.ts` | `setGlobalOptions` と callable の export を追加 |
| `functions/src/__tests__/emulator.ts` | Emulator 用テスト helper（DB 取得・クリア・シード） |
| `functions/src/**/__tests__/*.itest.ts` | Emulator 結合テスト |

### ルール・設定

| ファイル | 責務 |
| --- | --- |
| `firestore.rules` | 対象コレクションの読み取り規則（書き込みは全拒否） |
| `firestore.indexes.json` | collection group 用の単一フィールドインデックス |
| `storage.rules` | 本計画では変更しない（投稿画像は計画 3） |
| `firebase.json` | `emulators` ブロック |
| `package.json`（ルート） | `test:emulator` スクリプト |

### クライアント

| ファイル | 責務 |
| --- | --- |
| `nuxt.config.ts` | `runtimeConfig.public.useMock` / `useEmulator` |
| `app/plugins/firebase.client.ts` | Emulator 接続 |
| `app/plugins/firestore-sync.client.ts` | 本物モードで同期を開始 |
| `app/composables/useAppDb.ts` | モード別のリアクティブ DB を返す |
| `app/composables/useBackendReady.ts` | 認証・所属組織の初回読み込み完了の待機 |
| `app/composables/useFirestoreSync.ts` | `startFirestoreSync()` / `refreshAuthUser()`（Firestore → DB の流し込み） |
| `app/utils/firebase/emptyDb.ts` | 空の `MockDb` |
| `app/utils/firebase/converters.ts` | Firestore ドキュメント → ドメイン型 |
| `app/utils/firebase/mirror.ts` | 複数の購読結果を 1 つの配列にまとめる |
| `app/utils/firebase/callFunction.ts` | callable 呼び出しとエラー変換 |
| `app/utils/firebase/authErrors.ts` | Firebase Auth のエラーコード → 日本語 |
| `app/composables/useAuth.ts` / `useCurrentOrg.ts` / `useMembers.ts` / `useInvitation.ts` / `useStores.ts` / `useAdminNav.ts` | モード分岐 |
| `app/middleware/auth.global.ts` / `org-access.global.ts` | 初回読み込みを待ってから判定 |
| `app/layouts/admin.vue` / `app/components/Admin/Layout/ComingSoon.vue` / `SideNav.vue` | 準備中表示 |
| `app/pages/login.vue` / `invite/[token].vue` / `admin/[orgId]/settings/members.vue` | 本物モードでの表示調整 |
| `.claude/PROJECT.md` | MEO-Tool の実構成に書き直す |

---

### Task 1: Functions の共通処理と Emulator テスト基盤

**Files:**
- Create: `functions/src/shared/errors.ts`、`auth.ts`、`validation.ts`、`members.ts`、`audit.ts`、`callable.ts`
- Create: `functions/src/__tests__/emulator.ts`
- Test: `functions/src/shared/__tests__/members.itest.ts`、`functions/src/shared/__tests__/validation.test.ts`
- Modify: `functions/package.json`（`test:emulator`）、`package.json`（ルート、`test:emulator`）、`firebase.json`（`emulators`）

**Interfaces:**
- Consumes: なし
- Produces:
  - `fail(code: FunctionsErrorCode, message: string): never`
  - `interface Caller { uid: string; email: string }`、`requireCaller(request: CallableRequest<unknown>): Caller`
  - `asObject(data: unknown): Record<string, unknown>` / `requireString(value, label, maxLength = 200): string` / `requireId(value, label): string` / `requireOneOf<T extends string>(value, choices: readonly T[], label): T` / `requireStringArray(value, label, maxItems = 100): string[]` / `requireEmail(value): string`（小文字化）
  - 型 `MemberRole` / `OrgType` / `OrgLimits` / `OrgDoc` / `MemberDoc`、`orgRef(db, orgId)` / `memberRef(db, orgId, uid)`
  - `requireOrg(db, orgId, tx?): Promise<OrgDoc>` / `requireMember(db, orgId, uid, roles?, tx?): Promise<MemberDoc>` / `requireStoreAccess(member: MemberDoc, storeId: string): void`
  - `writeAuditLog(tx: Transaction, db: Firestore, orgId: string, action: string, actorUid: string, payload?: Record<string, unknown>): void`
  - `type Handler<T> = (db: Firestore, caller: Caller, data: unknown) => Promise<T>`、`callable<T>(handler: Handler<T>)`、`publicCallable<T>(handler: (db: Firestore, data: unknown) => Promise<T>)`
  - テスト helper: `TEST_PROJECT_ID` / `getTestDb(): Firestore` / `clearFirestore(): Promise<void>` / `caller(uid, email?): Caller` / `seedOrg(db, { orgId, type?, status?, maxMembers?, members: { uid, role, storeIds?, email? }[] }): Promise<void>` / `seedStore(db, orgId, storeId, name): Promise<void>`

- [ ] **Step 1: Emulator 設定とスクリプトを追加する**

`firebase.json` の末尾 `"storage"` ブロックの後に追加する（`"storage": {...}` の閉じ括弧の後にカンマを付ける）。

```json
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
```

`functions/package.json` の `scripts` に追加する。

```json
    "test:emulator": "tsc -p tsconfig.test.json && node --test --test-concurrency=1 \"lib-test/**/__tests__/*.itest.js\"",
```

ルートの `package.json` の `scripts` に追加する。

```json
    "test:emulator": "firebase emulators:exec --only firestore --project demo-meo-tool \"npm --prefix functions run test:emulator\"",
```

- [ ] **Step 2: テスト helper を作る**

`functions/src/__tests__/emulator.ts`:

```ts
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import type { MemberRole, OrgType } from '../shared/members'

export const TEST_PROJECT_ID = 'demo-meo-tool'

export function getTestDb(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST が未設定です。ルートで npm run test:emulator を実行してください')
  }
  const app = getApps()[0] ?? initializeApp({ projectId: TEST_PROJECT_ID })
  return getFirestore(app)
}

export async function clearFirestore(): Promise<void> {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`
  const response = await fetch(url, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Firestore のクリアに失敗しました: HTTP ${response.status}`)
}

export function caller(uid: string, email = `${uid}@example.com`): Caller {
  return { uid, email }
}

interface SeedMember {
  uid: string
  role: MemberRole
  storeIds?: string[]
  email?: string
}

interface SeedOrgInput {
  orgId: string
  type?: OrgType
  status?: 'active' | 'suspended' | 'deleted'
  maxMembers?: number
  members: SeedMember[]
}

export async function seedOrg(db: Firestore, input: SeedOrgInput): Promise<void> {
  const owner = input.members.find(member => member.role === 'owner')
  await db.doc(`organizations/${input.orgId}`).set({
    type: input.type ?? 'corporate',
    name: `組織 ${input.orgId}`,
    plan: 'ビジネス',
    status: input.status ?? 'active',
    limits: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: input.maxMembers ?? 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
    ownerUid: owner?.uid ?? 'nobody',
    createdAt: FieldValue.serverTimestamp(),
  })
  for (const member of input.members) {
    await db.doc(`organizations/${input.orgId}/members/${member.uid}`).set({
      orgId: input.orgId,
      uid: member.uid,
      role: member.role,
      storeIds: member.storeIds ?? [],
      email: member.email ?? `${member.uid}@example.com`,
      displayName: member.uid,
      joinedAt: FieldValue.serverTimestamp(),
    })
  }
}

export async function seedStore(db: Firestore, orgId: string, storeId: string, name: string): Promise<void> {
  await db.doc(`organizations/${orgId}/stores/${storeId}`).set({ orgId, name, status: 'active' })
}
```

- [ ] **Step 3: 失敗するテストを書く**

`functions/src/shared/__tests__/validation.test.ts`（Emulator 不要の単体テスト）:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asObject, requireEmail, requireId, requireOneOf, requireString, requireStringArray } from '../validation'

const invalid = { code: 'invalid-argument' }

test('asObject: オブジェクト以外は invalid-argument', () => {
  assert.deepEqual(asObject({ a: 1 }), { a: 1 })
  for (const value of [null, undefined, 'x', 1, []]) assert.throws(() => asObject(value), invalid)
})

test('requireString: 前後の空白を除き、空・型違い・長すぎは invalid-argument', () => {
  assert.equal(requireString('  ハナミ  ', '組織名'), 'ハナミ')
  assert.throws(() => requireString('   ', '組織名'), { code: 'invalid-argument', message: '組織名を入力してください。' })
  assert.throws(() => requireString(1, '組織名'), invalid)
  assert.throws(() => requireString('a'.repeat(11), '組織名', 10), { message: '組織名は 10 文字以内にしてください。' })
})

test('requireId: 英数字・ハイフン・アンダースコアのみ', () => {
  assert.equal(requireId('org-abc_1', '組織 ID'), 'org-abc_1')
  assert.throws(() => requireId('org/../x', '組織 ID'), invalid)
})

test('requireOneOf: 選択肢にない値は invalid-argument', () => {
  assert.equal(requireOneOf('admin', ['admin', 'staff'] as const, '権限'), 'admin')
  assert.throws(() => requireOneOf('owner', ['admin', 'staff'] as const, '権限'), invalid)
})

test('requireStringArray: 重複を除き、空文字・型違い・件数超過は invalid-argument', () => {
  assert.deepEqual(requireStringArray(['a', 'b', 'a'], '担当店舗'), ['a', 'b'])
  assert.throws(() => requireStringArray(['a', ''], '担当店舗'), invalid)
  assert.throws(() => requireStringArray('a', '担当店舗'), invalid)
  assert.throws(() => requireStringArray(['a', 'b', 'c'], '担当店舗', 2), invalid)
})

test('requireEmail: 小文字化し、形式違いは invalid-argument', () => {
  assert.equal(requireEmail(' Tanaka@Example.COM '), 'tanaka@example.com')
  assert.throws(() => requireEmail('tanaka'), { code: 'invalid-argument', message: 'メールアドレスの形式が正しくありません。' })
})
```

`functions/src/shared/__tests__/members.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { requireMember, requireOrg, requireStoreAccess } from '../members'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-owner', role: 'owner' }] })
})

test('requireOrg: 有効な組織を返す', async () => {
  const org = await requireOrg(db, 'org-a')
  assert.equal(org.type, 'corporate')
})

test('requireOrg: 存在しなければ not-found、停止中なら failed-precondition', async () => {
  await assert.rejects(requireOrg(db, 'org-none'), { code: 'not-found', message: '組織が見つかりません。' })
  await assert.rejects(requireOrg(db, 'org-stop'), { code: 'failed-precondition', message: 'この組織は利用停止中です。' })
})

test('requireMember: メンバーでなければ permission-denied', async () => {
  await assert.rejects(requireMember(db, 'org-a', 'u-other'), { code: 'permission-denied', message: 'この組織のメンバーではありません。' })
})

test('requireMember: ロール指定に合わなければ permission-denied', async () => {
  const owner = await requireMember(db, 'org-a', 'u-owner', ['owner', 'admin'])
  assert.equal(owner.role, 'owner')
  await assert.rejects(requireMember(db, 'org-a', 'u-staff', ['owner', 'admin']), { code: 'permission-denied', message: 'この操作の権限がありません。' })
})

test('requireMember: トランザクション内でも読める', async () => {
  const member = await db.runTransaction(tx => requireMember(db, 'org-a', 'u-staff', undefined, tx))
  assert.deepEqual(member.storeIds, ['st-1'])
})

test('requireStoreAccess: staff は担当店舗のみ、owner は全店舗', async () => {
  const staff = await requireMember(db, 'org-a', 'u-staff')
  const owner = await requireMember(db, 'org-a', 'u-owner')
  requireStoreAccess(staff, 'st-1')
  requireStoreAccess(owner, 'st-9')
  assert.throws(() => requireStoreAccess(staff, 'st-2'), { code: 'permission-denied', message: '担当外の店舗です。' })
})
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../validation'` など）

- [ ] **Step 5: 共通処理を実装する**

`functions/src/shared/errors.ts`:

```ts
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https'

/** callable の呼び出し元へ返すエラーを投げる。メッセージは画面にそのまま表示される */
export function fail(code: FunctionsErrorCode, message: string): never {
  throw new HttpsError(code, message)
}
```

`functions/src/shared/auth.ts`:

```ts
import type { CallableRequest } from 'firebase-functions/https'
import { fail } from './errors'

export interface Caller {
  uid: string
  /** 小文字化済み。メール未設定のアカウントは空文字 */
  email: string
}

export function requireCaller(request: CallableRequest<unknown>): Caller {
  const auth = request.auth
  if (!auth) fail('unauthenticated', 'ログインしてください。')
  const email = typeof auth.token.email === 'string' ? auth.token.email.toLowerCase() : ''
  return { uid: auth.uid, email }
}
```

`functions/src/shared/validation.ts`:

```ts
import { fail } from './errors'

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function asObject(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail('invalid-argument', 'リクエストの形式が正しくありません。')
  }
  return data as Record<string, unknown>
}

export function requireString(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim() === '') fail('invalid-argument', `${label}を入力してください。`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) fail('invalid-argument', `${label}は ${maxLength} 文字以内にしてください。`)
  return trimmed
}

/** ドキュメント ID として使う値。パス区切りなどを含めない */
export function requireId(value: unknown, label: string): string {
  const id = requireString(value, label, 128)
  if (!ID_PATTERN.test(id)) fail('invalid-argument', `${label}の形式が正しくありません。`)
  return id
}

export function requireOneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail('invalid-argument', `${label}の値が正しくありません。`)
  return value as T
}

export function requireStringArray(value: unknown, label: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item === '')) {
    fail('invalid-argument', `${label}の値が正しくありません。`)
  }
  return [...new Set(value as string[])]
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'メールアドレス', 254).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) fail('invalid-argument', 'メールアドレスの形式が正しくありません。')
  return email
}
```

`functions/src/shared/members.ts`:

```ts
import type { DocumentReference, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore'
import { fail } from './errors'

export type MemberRole = 'owner' | 'admin' | 'staff'
export type OrgType = 'individual' | 'corporate'

export interface OrgLimits {
  maxStores: number
  maxSurveys: number
  maxKeywords: number
  maxMembers: number
  monthlyReviewDrafts: number
  monthlyRankChecks: number
}

export interface OrgDoc {
  type: OrgType
  name: string
  plan: string
  status: 'active' | 'suspended' | 'deleted'
  limits: OrgLimits
  ownerUid: string
}

export interface MemberDoc {
  orgId: string
  uid: string
  role: MemberRole
  storeIds: string[]
  email: string
  displayName: string
  joinedAt: Timestamp
}

export function orgRef(db: Firestore, orgId: string): DocumentReference {
  return db.doc(`organizations/${orgId}`)
}

export function memberRef(db: Firestore, orgId: string, uid: string): DocumentReference {
  return db.doc(`organizations/${orgId}/members/${uid}`)
}

function read(ref: DocumentReference, tx?: Transaction) {
  return tx ? tx.get(ref) : ref.get()
}

export async function requireOrg(db: Firestore, orgId: string, tx?: Transaction): Promise<OrgDoc> {
  const snapshot = await read(orgRef(db, orgId), tx)
  if (!snapshot.exists) fail('not-found', '組織が見つかりません。')
  const org = snapshot.data() as OrgDoc
  if (org.status !== 'active') fail('failed-precondition', 'この組織は利用停止中です。')
  return org
}

export async function requireMember(
  db: Firestore,
  orgId: string,
  uid: string,
  roles?: MemberRole[],
  tx?: Transaction,
): Promise<MemberDoc> {
  const snapshot = await read(memberRef(db, orgId, uid), tx)
  if (!snapshot.exists) fail('permission-denied', 'この組織のメンバーではありません。')
  const member = snapshot.data() as MemberDoc
  if (roles && !roles.includes(member.role)) fail('permission-denied', 'この操作の権限がありません。')
  return member
}

/** staff は担当店舗だけ操作できる */
export function requireStoreAccess(member: MemberDoc, storeId: string): void {
  if (member.role === 'staff' && !member.storeIds.includes(storeId)) fail('permission-denied', '担当外の店舗です。')
}
```

`functions/src/shared/audit.ts`:

```ts
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'

/** 監査ログを同じトランザクションで書く（本体の書き込みと一緒に確定させる） */
export function writeAuditLog(
  tx: Transaction,
  db: Firestore,
  orgId: string,
  action: string,
  actorUid: string,
  payload: Record<string, unknown> = {},
): void {
  tx.create(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
    action,
    actorUid,
    payload,
    createdAt: FieldValue.serverTimestamp(),
  })
}
```

`functions/src/shared/callable.ts`:

```ts
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/https'
import { requireCaller, type Caller } from './auth'

export type Handler<T> = (db: Firestore, caller: Caller, data: unknown) => Promise<T>

/** ログイン必須の callable */
export function callable<T>(handler: Handler<T>) {
  return onCall(request => handler(getFirestore(), requireCaller(request), request.data))
}

/** ログイン不要の callable（招待の確認など） */
export function publicCallable<T>(handler: (db: Firestore, data: unknown) => Promise<T>) {
  return onCall(request => handler(getFirestore(), request.data))
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（GBP の 38 件 + validation 6 件 = 44 件）

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`（ルートで実行）
Expected: PASS（members 6 件）。末尾に `Script exited successfully (code 0)`

- [ ] **Step 7: 本番ビルドを確認する**

Run: `cd functions && npm run build`
Expected: 成功。`lib/__tests__` と `lib/shared/__tests__` が無い

---

### Task 2: 組織作成（`createOrganizationFunc`）

**Files:**
- Create: `functions/src/identity/limits.ts`、`functions/src/identity/createOrganization.ts`
- Test: `functions/src/identity/__tests__/createOrganization.itest.ts`

**Interfaces:**
- Consumes: Task 1 の `fail` / `Caller` / `asObject` / `requireId` / `requireOneOf` / `requireString` / `orgRef` / `memberRef` / `OrgDoc` / `OrgType` / `writeAuditLog`、テスト helper
- Produces:
  - `DEFAULT_LIMITS: Record<OrgType, OrgLimits>` / `PLAN_NAMES: Record<OrgType, string>`
  - `createOrganizationFunc(db, caller, data: { requestId: string; type: OrgType; orgName: string; displayName: string }): Promise<{ orgId: string }>`
  - 組織 ID は `org-{requestId}`。`users/{uid}` に `{ email, displayName, platformRole: null, lastOrgId }` を保存する

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/identity/__tests__/createOrganization.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb } from '../../__tests__/emulator'
import { createOrganizationFunc } from '../createOrganization'

const db = getTestDb()
const input = { requestId: 'req12345678', type: 'corporate', orgName: ' ハナミ食堂 ', displayName: '田中' }

beforeEach(() => clearFirestore())

test('組織・owner メンバー・ユーザーを作成する', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1', 'tanaka@example.com'), input)

  assert.equal(orgId, 'org-req12345678')
  const org = (await db.doc(`organizations/${orgId}`).get()).data()!
  assert.equal(org.name, 'ハナミ食堂')
  assert.equal(org.type, 'corporate')
  assert.equal(org.plan, 'ビジネス')
  assert.equal(org.status, 'active')
  assert.equal(org.ownerUid, 'u-1')
  assert.equal(org.limits.maxMembers, 20)

  const member = (await db.doc(`organizations/${orgId}/members/u-1`).get()).data()!
  assert.equal(member.role, 'owner')
  assert.equal(member.orgId, orgId)
  assert.equal(member.uid, 'u-1')
  assert.equal(member.email, 'tanaka@example.com')
  assert.equal(member.displayName, '田中')

  const user = (await db.doc('users/u-1').get()).data()!
  assert.equal(user.lastOrgId, orgId)
  assert.equal(user.platformRole, null)

  const logs = await db.collection(`organizations/${orgId}/auditLogs`).get()
  assert.equal(logs.size, 1)
  assert.equal(logs.docs[0].get('action'), 'organization.create')
})

test('個人組織はライトプラン・メンバー上限 1', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1'), { ...input, type: 'individual' })
  const org = (await db.doc(`organizations/${orgId}`).get()).data()!
  assert.equal(org.plan, 'ライト')
  assert.equal(org.limits.maxMembers, 1)
})

test('同じ requestId の再送は同じ組織を返し、重複作成しない', async () => {
  const first = await createOrganizationFunc(db, caller('u-1'), input)
  const second = await createOrganizationFunc(db, caller('u-1'), input)

  assert.equal(second.orgId, first.orgId)
  const orgs = await db.collection('organizations').where('ownerUid', '==', 'u-1').get()
  assert.equal(orgs.size, 1)
  const logs = await db.collection(`organizations/${first.orgId}/auditLogs`).get()
  assert.equal(logs.size, 1)
})

test('別ユーザーが同じ requestId を使うと already-exists', async () => {
  await createOrganizationFunc(db, caller('u-1'), input)
  await assert.rejects(createOrganizationFunc(db, caller('u-2'), input), { code: 'already-exists' })
})

test('入力不正は invalid-argument', async () => {
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, type: 'company' }), { code: 'invalid-argument' })
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, orgName: '' }), { code: 'invalid-argument', message: '組織名を入力してください。' })
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, requestId: 'a/b' }), { code: 'invalid-argument' })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../createOrganization'`）

- [ ] **Step 3: 実装する**

`functions/src/identity/limits.ts`:

```ts
import type { OrgLimits, OrgType } from '../shared/members'

// app/utils/mock/functions/identity.ts の DEFAULT_LIMITS と同じ値（料金プランは I-16 で確定予定）
export const DEFAULT_LIMITS: Record<OrgType, OrgLimits> = {
  individual: { maxStores: 1, maxSurveys: 3, maxKeywords: 5, maxMembers: 1, monthlyReviewDrafts: 100, monthlyRankChecks: 200 },
  corporate: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
}

export const PLAN_NAMES: Record<OrgType, string> = {
  individual: 'ライト',
  corporate: 'ビジネス',
}
```

`functions/src/identity/createOrganization.ts`:

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { memberRef, orgRef, type OrgDoc, type OrgType } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { DEFAULT_LIMITS, PLAN_NAMES } from './limits'

const ORG_TYPES: readonly OrgType[] = ['individual', 'corporate']

/**
 * F-01 新規登録: 組織と owner メンバーを作る。
 * 組織 ID をクライアント発行の requestId から決めるため、再送しても組織は 1 つだけ。
 */
export async function createOrganizationFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ orgId: string }> {
  const input = asObject(data)
  const requestId = requireId(input.requestId, 'リクエスト ID')
  const type = requireOneOf(input.type, ORG_TYPES, '組織種別')
  const orgName = requireString(input.orgName, '組織名', 100)
  const displayName = requireString(input.displayName, '表示名', 50)
  const orgId = `org-${requestId}`

  return db.runTransaction(async (tx) => {
    const userRef = db.doc(`users/${caller.uid}`)
    const [existingOrg, existingUser] = await Promise.all([tx.get(orgRef(db, orgId)), tx.get(userRef)])
    if (existingOrg.exists) {
      if ((existingOrg.data() as OrgDoc).ownerUid !== caller.uid) fail('already-exists', 'この組織はすでに作成されています。')
      return { orgId }
    }

    const now = FieldValue.serverTimestamp()
    tx.set(userRef, {
      email: caller.email,
      displayName,
      platformRole: null,
      lastOrgId: orgId,
      updatedAt: now,
      ...(existingUser.exists ? {} : { createdAt: now }),
    }, { merge: true })
    tx.create(orgRef(db, orgId), {
      type,
      name: orgName,
      plan: PLAN_NAMES[type],
      status: 'active',
      limits: { ...DEFAULT_LIMITS[type] },
      ownerUid: caller.uid,
      createdAt: now,
      updatedAt: now,
    })
    tx.create(memberRef(db, orgId, caller.uid), {
      orgId,
      uid: caller.uid,
      role: 'owner',
      storeIds: [],
      email: caller.email,
      displayName,
      joinedAt: now,
    })
    writeAuditLog(tx, db, orgId, 'organization.create', caller.uid)
    return { orgId }
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（members 6 件 + createOrganization 5 件 = 11 件）

---

### Task 3: 招待（作成・確認・受諾・取消）

**Files:**
- Create: `functions/src/identity/invitations.ts`
- Test: `functions/src/identity/__tests__/invitations.itest.ts`

**Interfaces:**
- Consumes: Task 1 の共通処理、テスト helper（`seedStore` を含む）
- Produces:
  - `hashToken(token: string): string`（SHA-256 hex）
  - `interface InvitationResult { id; orgId; email; role: 'admin' | 'staff'; storeIds: string[]; status: 'pending' | 'accepted' | 'revoked' | 'expired'; token: string; expiresAt: string; invitedBy: string; createdAt: string }`（クライアントの `Invitation` 型と同じ形。日時は ISO 文字列）
  - `createInvitationFunc(db, caller, { orgId, email, role, storeIds }): Promise<InvitationResult>`（`token` は平文）
  - `getInvitationFunc(db, { token }): Promise<{ invitation: InvitationResult; org: { name: string; type: OrgType }; storeNames: string[] }>`（`token` と `invitedBy` は空文字で返す）
  - `updateInvitationAcceptFunc(db, caller, { token, displayName }): Promise<{ orgId: string }>`
  - `updateInvitationRevokeFunc(db, caller, { orgId, invitationId }): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/identity/__tests__/invitations.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import {
  createInvitationFunc,
  getInvitationFunc,
  hashToken,
  updateInvitationAcceptFunc,
  updateInvitationRevokeFunc,
} from '../invitations'

const db = getTestDb()
const OWNER = caller('u-owner')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    maxMembers: 3,
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
  await seedOrg(db, { orgId: 'org-solo', type: 'individual', members: [{ uid: 'u-solo', role: 'owner' }] })
})

async function expireInvitation(orgId: string, invitationId: string) {
  await db.doc(`organizations/${orgId}/invitations/${invitationId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
}

test('createInvitation: 平文トークンを返し、保存はハッシュのみ', async () => {
  const invitation = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: ' New@Example.com ', role: 'staff', storeIds: ['st-1'] })

  assert.equal(invitation.email, 'new@example.com')
  assert.equal(invitation.status, 'pending')
  assert.ok(invitation.token.length >= 32)
  const saved = (await db.doc(`organizations/org-a/invitations/${invitation.id}`).get()).data()!
  assert.equal(saved.tokenHash, hashToken(invitation.token))
  assert.equal(saved.token, undefined)
  assert.ok(Date.parse(invitation.expiresAt) > Date.now() + 6 * 24 * 3600 * 1000)
})

test('createInvitation: staff・個人組織・既存メンバー・送信済みは拒否', async () => {
  await assert.rejects(
    createInvitationFunc(db, caller('u-staff'), { orgId: 'org-a', email: 'x@example.com', role: 'admin', storeIds: [] }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    createInvitationFunc(db, caller('u-solo'), { orgId: 'org-solo', email: 'x@example.com', role: 'admin', storeIds: [] }),
    { code: 'failed-precondition', message: 'メンバー招待は法人組織のみ利用できます。' },
  )
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'U-STAFF@example.com', role: 'admin', storeIds: [] }),
    { code: 'already-exists', message: 'すでにメンバーです。' },
  )
  await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'X@example.com', role: 'admin', storeIds: [] }),
    { code: 'already-exists', message: 'このメールアドレスには招待を送信済みです。' },
  )
})

test('createInvitation: staff は担当店舗が必須で、存在しない店舗は拒否', async () => {
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'staff', storeIds: [] }),
    { code: 'invalid-argument', message: 'スタッフには担当店舗を 1 つ以上選んでください。' },
  )
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'staff', storeIds: ['st-none'] }),
    { code: 'invalid-argument', message: '担当店舗に存在しない店舗が含まれています。' },
  )
})

test('createInvitation: メンバー + 有効な招待が上限に達したら resource-exhausted（期限切れは数えない）', async () => {
  const expired = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'old@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', expired.id)
  // メンバー 2 + 有効な招待 0 → 3 人目の招待は可能
  await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'a@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'b@example.com', role: 'admin', storeIds: [] }),
    { code: 'resource-exhausted', message: 'メンバー数の上限（3 名）に達しています。' },
  )
})

test('getInvitation: トークンで招待・組織名・店舗名を返す（トークンは返さない）', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'staff', storeIds: ['st-1'] })

  const result = await getInvitationFunc(db, { token: created.token })

  assert.equal(result.invitation.id, created.id)
  assert.equal(result.invitation.token, '')
  assert.equal(result.org.name, '組織 org-a')
  assert.deepEqual(result.storeNames, ['渋谷店'])
})

test('getInvitation: 不明なトークンは not-found、期限切れは status=expired', async () => {
  await assert.rejects(getInvitationFunc(db, { token: 'unknown-token' }), { code: 'not-found', message: '招待が見つかりません。URL をご確認ください。' })
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', created.id)
  const result = await getInvitationFunc(db, { token: created.token })
  assert.equal(result.invitation.status, 'expired')
})

test('acceptInvitation: メールが一致すればメンバーになり、招待は accepted', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'New@Example.com', role: 'staff', storeIds: ['st-1'] })

  const { orgId } = await updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' })

  assert.equal(orgId, 'org-a')
  const member = (await db.doc('organizations/org-a/members/u-new').get()).data()!
  assert.equal(member.role, 'staff')
  assert.deepEqual(member.storeIds, ['st-1'])
  assert.equal(member.displayName, '新人')
  assert.equal(member.orgId, 'org-a')
  const invitation = (await db.doc(`organizations/org-a/invitations/${created.id}`).get()).data()!
  assert.equal(invitation.status, 'accepted')
  assert.equal((await db.doc('users/u-new').get()).get('lastOrgId'), 'org-a')
})

test('acceptInvitation: メール不一致・受諾済み・期限切れ・既存メンバーは拒否', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-x', 'other@example.com'), { token: created.token, displayName: 'X' }),
    { code: 'permission-denied', message: '招待されたメールアドレス（new@example.com）でログインしてください。' },
  )
  await updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' }),
    { code: 'failed-precondition', message: 'この招待は無効です（期限切れ・取消済み・受諾済み）。' },
  )

  const expired = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'late@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', expired.id)
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-late', 'late@example.com'), { token: expired.token, displayName: 'L' }),
    { code: 'failed-precondition' },
  )

  const dup = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'dup@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-staff', 'dup@example.com'), { token: dup.token, displayName: 'D' }),
    { code: 'already-exists', message: 'すでにこの組織のメンバーです。' },
  )
})

test('revokeInvitation: owner / admin が pending を取り消せる。取消済み・staff は拒否', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationRevokeFunc(db, caller('u-staff'), { orgId: 'org-a', invitationId: created.id }),
    { code: 'permission-denied' },
  )

  await updateInvitationRevokeFunc(db, OWNER, { orgId: 'org-a', invitationId: created.id })

  assert.equal((await db.doc(`organizations/org-a/invitations/${created.id}`).get()).get('status'), 'revoked')
  await assert.rejects(
    updateInvitationRevokeFunc(db, OWNER, { orgId: 'org-a', invitationId: created.id }),
    { code: 'not-found', message: '取り消せる招待がありません。' },
  )
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../invitations'`）

- [ ] **Step 3: 実装する**

`functions/src/identity/invitations.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { memberRef, orgRef, requireMember, requireOrg, type OrgDoc, type OrgType } from '../shared/members'
import { asObject, requireEmail, requireId, requireOneOf, requireString, requireStringArray } from '../shared/validation'

const INVITABLE_ROLES = ['admin', 'staff'] as const
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000

type InvitableRole = typeof INVITABLE_ROLES[number]
type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

interface InvitationDoc {
  orgId: string
  email: string
  role: InvitableRole
  storeIds: string[]
  status: Exclude<InvitationStatus, 'expired'>
  tokenHash: string
  expiresAt: Timestamp
  invitedBy: string
  createdAt?: Timestamp
}

/** クライアントの Invitation 型と同じ形 */
export interface InvitationResult {
  id: string
  orgId: string
  email: string
  role: InvitableRole
  storeIds: string[]
  status: InvitationStatus
  token: string
  expiresAt: string
  invitedBy: string
  createdAt: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isActivePending(invitation: InvitationDoc, now = Date.now()): boolean {
  return invitation.status === 'pending' && invitation.expiresAt.toMillis() > now
}

function toResult(id: string, invitation: InvitationDoc, token: string, invitedBy: string): InvitationResult {
  const isExpired = invitation.status === 'pending' && !isActivePending(invitation)
  return {
    id,
    orgId: invitation.orgId,
    email: invitation.email,
    role: invitation.role,
    storeIds: invitation.storeIds,
    status: isExpired ? 'expired' : invitation.status,
    token,
    expiresAt: invitation.expiresAt.toDate().toISOString(),
    invitedBy,
    createdAt: (invitation.createdAt ?? Timestamp.now()).toDate().toISOString(),
  }
}

async function findByToken(db: Firestore, token: string): Promise<DocumentSnapshot> {
  const snapshot = await db.collectionGroup('invitations').where('tokenHash', '==', hashToken(token)).limit(1).get()
  if (snapshot.empty) fail('not-found', '招待が見つかりません。URL をご確認ください。')
  return snapshot.docs[0]
}

/** F-03 招待の作成（法人のみ・owner / admin） */
export async function createInvitationFunc(db: Firestore, caller: Caller, data: unknown): Promise<InvitationResult> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const email = requireEmail(input.email)
  const role = requireOneOf(input.role, INVITABLE_ROLES, '権限')
  const storeIds = role === 'staff' ? requireStringArray(input.storeIds, '担当店舗') : []
  if (role === 'staff' && storeIds.length === 0) fail('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')

  const token = randomBytes(24).toString('base64url')
  return db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    if (org.type !== 'corporate') fail('failed-precondition', 'メンバー招待は法人組織のみ利用できます。')

    const [members, pending, stores] = await Promise.all([
      tx.get(db.collection(`organizations/${orgId}/members`)),
      tx.get(db.collection(`organizations/${orgId}/invitations`).where('status', '==', 'pending')),
      Promise.all(storeIds.map(id => tx.get(db.doc(`organizations/${orgId}/stores/${id}`)))),
    ])
    const activePending = pending.docs.filter(doc => isActivePending(doc.data() as InvitationDoc))
    if (members.size + activePending.length >= org.limits.maxMembers) {
      fail('resource-exhausted', `メンバー数の上限（${org.limits.maxMembers} 名）に達しています。`)
    }
    if (members.docs.some(doc => String(doc.get('email')).toLowerCase() === email)) fail('already-exists', 'すでにメンバーです。')
    if (activePending.some(doc => doc.get('email') === email)) fail('already-exists', 'このメールアドレスには招待を送信済みです。')
    if (stores.some(store => !store.exists)) fail('invalid-argument', '担当店舗に存在しない店舗が含まれています。')

    const ref = db.collection(`organizations/${orgId}/invitations`).doc()
    const now = Timestamp.now()
    const invitation: InvitationDoc = {
      orgId,
      email,
      role,
      storeIds,
      status: 'pending',
      tokenHash: hashToken(token),
      expiresAt: Timestamp.fromMillis(now.toMillis() + EXPIRES_IN_MS),
      invitedBy: caller.uid,
      createdAt: now,
    }
    tx.create(ref, invitation)
    writeAuditLog(tx, db, orgId, 'invitation.create', caller.uid, { invitationId: ref.id, email, role })
    return toResult(ref.id, invitation, token, caller.uid)
  })
}

/** 招待画面（未ログインでも開ける）向けの確認。トークンは返さない */
export async function getInvitationFunc(
  db: Firestore,
  data: unknown,
): Promise<{ invitation: InvitationResult; org: { name: string; type: OrgType }; storeNames: string[] }> {
  const token = requireString(asObject(data).token, '招待トークン', 128)
  const snapshot = await findByToken(db, token)
  const invitation = snapshot.data() as InvitationDoc
  const [orgSnapshot, ...storeSnapshots] = await Promise.all([
    orgRef(db, invitation.orgId).get(),
    ...invitation.storeIds.map(id => db.doc(`organizations/${invitation.orgId}/stores/${id}`).get()),
  ])
  const org = orgSnapshot.data() as OrgDoc | undefined
  if (!org) fail('not-found', '招待が見つかりません。URL をご確認ください。')
  return {
    invitation: toResult(snapshot.id, invitation, '', ''),
    org: { name: org.name, type: org.type },
    storeNames: storeSnapshots.map((store, index) => String(store.get('name') ?? invitation.storeIds[index])),
  }
}

/** 招待の受諾。招待されたメールアドレスのアカウントだけが受諾できる */
export async function updateInvitationAcceptFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ orgId: string }> {
  const input = asObject(data)
  const token = requireString(input.token, '招待トークン', 128)
  const displayName = requireString(input.displayName, '表示名', 50)
  const found = await findByToken(db, token)

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(found.ref)
    const invitation = snapshot.data() as InvitationDoc
    const userRef = db.doc(`users/${caller.uid}`)
    const [member, user] = await Promise.all([tx.get(memberRef(db, invitation.orgId, caller.uid)), tx.get(userRef)])
    await requireOrg(db, invitation.orgId, tx)

    if (!isActivePending(invitation)) fail('failed-precondition', 'この招待は無効です（期限切れ・取消済み・受諾済み）。')
    if (caller.email !== invitation.email) {
      fail('permission-denied', `招待されたメールアドレス（${invitation.email}）でログインしてください。`)
    }
    if (member.exists) fail('already-exists', 'すでにこの組織のメンバーです。')

    const now = FieldValue.serverTimestamp()
    tx.create(memberRef(db, invitation.orgId, caller.uid), {
      orgId: invitation.orgId,
      uid: caller.uid,
      role: invitation.role,
      storeIds: invitation.storeIds,
      email: caller.email,
      displayName,
      joinedAt: now,
    })
    tx.update(snapshot.ref, { status: 'accepted', acceptedBy: caller.uid, acceptedAt: now })
    tx.set(userRef, {
      email: caller.email,
      displayName,
      lastOrgId: invitation.orgId,
      updatedAt: now,
      ...(user.exists ? {} : { platformRole: null, createdAt: now }),
    }, { merge: true })
    writeAuditLog(tx, db, invitation.orgId, 'invitation.accept', caller.uid, { invitationId: snapshot.id })
    return { orgId: invitation.orgId }
  })
}

export async function updateInvitationRevokeFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const invitationId = requireId(input.invitationId, '招待 ID')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const snapshot = await tx.get(db.doc(`organizations/${orgId}/invitations/${invitationId}`))
    if (!snapshot.exists || !isActivePending(snapshot.data() as InvitationDoc)) fail('not-found', '取り消せる招待がありません。')
    tx.update(snapshot.ref, { status: 'revoked', revokedBy: caller.uid, revokedAt: FieldValue.serverTimestamp() })
    writeAuditLog(tx, db, orgId, 'invitation.revoke', caller.uid, { invitationId })
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（11 件 + invitations 9 件 = 20 件）

---

### Task 4: メンバー権限・組織名と callable の公開

**Files:**
- Create: `functions/src/identity/members.ts`
- Test: `functions/src/identity/__tests__/members.itest.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 1〜3 のすべて
- Produces:
  - `updateMemberRoleFunc(db, caller, { orgId, targetUid, role: 'admin' | 'staff', storeIds }): Promise<void>`
  - `deleteMemberFunc(db, caller, { orgId, targetUid }): Promise<void>`
  - `updateOrganizationNameFunc(db, caller, { orgId, name }): Promise<void>`
  - callable（クライアントが呼ぶ名前）: `createOrganization` / `createInvitation` / `getInvitation` / `updateInvitationAccept` / `updateInvitationRevoke` / `updateMemberRole` / `deleteMember` / `updateOrganizationName`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/identity/__tests__/members.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { deleteMemberFunc, updateMemberRoleFunc, updateOrganizationNameFunc } from '../members'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-admin', role: 'admin' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
})

test('updateMemberRole: admin を staff にすると担当店舗を保存し、admin にすると空にする', async () => {
  await updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: ['st-2'] })
  assert.deepEqual((await db.doc('organizations/org-a/members/u-admin').get()).get('storeIds'), ['st-2'])

  await updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'admin', storeIds: ['st-2'] })
  const admin = (await db.doc('organizations/org-a/members/u-admin').get()).data()!
  assert.equal(admin.role, 'admin')
  assert.deepEqual(admin.storeIds, [])
})

test('updateMemberRole: owner は変更不可、staff は実行不可、staff には担当店舗が必須', async () => {
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-owner', role: 'admin', storeIds: [] }),
    { code: 'failed-precondition', message: 'オーナーの権限は変更できません。' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-staff'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: ['st-1'] }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: [] }),
    { code: 'invalid-argument', message: 'スタッフには担当店舗を 1 つ以上選んでください。' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-none', role: 'admin', storeIds: [] }),
    { code: 'not-found', message: 'メンバーが見つかりません。' },
  )
})

test('deleteMember: メンバーを削除する。owner・自分自身は削除不可', async () => {
  await deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-staff' })
  assert.equal((await db.doc('organizations/org-a/members/u-staff').get()).exists, false)

  await assert.rejects(
    deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-owner' }),
    { code: 'failed-precondition', message: 'オーナーは削除できません。' },
  )
  await assert.rejects(
    deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-admin' }),
    { code: 'failed-precondition', message: '自分自身は削除できません。' },
  )
})

test('updateOrganizationName: owner のみ変更でき、空は拒否', async () => {
  await updateOrganizationNameFunc(db, caller('u-owner'), { orgId: 'org-a', name: ' 新しい名前 ' })
  assert.equal((await db.doc('organizations/org-a').get()).get('name'), '新しい名前')

  await assert.rejects(updateOrganizationNameFunc(db, caller('u-admin'), { orgId: 'org-a', name: 'x' }), { code: 'permission-denied' })
  await assert.rejects(
    updateOrganizationNameFunc(db, caller('u-owner'), { orgId: 'org-a', name: '  ' }),
    { code: 'invalid-argument', message: '組織名を入力してください。' },
  )
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../members'`）

- [ ] **Step 3: 実装する**

`functions/src/identity/members.ts`:

```ts
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { memberRef, orgRef, requireMember, requireOrg, type MemberDoc } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString, requireStringArray } from '../shared/validation'

const ASSIGNABLE_ROLES = ['admin', 'staff'] as const

async function requireTarget(db: Firestore, orgId: string, uid: string, tx: Transaction): Promise<MemberDoc> {
  const snapshot = await tx.get(memberRef(db, orgId, uid))
  if (!snapshot.exists) fail('not-found', 'メンバーが見つかりません。')
  return snapshot.data() as MemberDoc
}

export async function updateMemberRoleFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const targetUid = requireId(input.targetUid, 'メンバー')
  const role = requireOneOf(input.role, ASSIGNABLE_ROLES, '権限')
  const storeIds = role === 'staff' ? requireStringArray(input.storeIds, '担当店舗') : []
  if (role === 'staff' && storeIds.length === 0) fail('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const target = await requireTarget(db, orgId, targetUid, tx)
    if (target.role === 'owner') fail('failed-precondition', 'オーナーの権限は変更できません。')
    tx.update(memberRef(db, orgId, targetUid), { role, storeIds })
    writeAuditLog(tx, db, orgId, 'member.updateRole', caller.uid, { targetUid, role, storeIds })
  })
}

export async function deleteMemberFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const targetUid = requireId(input.targetUid, 'メンバー')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const target = await requireTarget(db, orgId, targetUid, tx)
    if (target.role === 'owner') fail('failed-precondition', 'オーナーは削除できません。')
    if (targetUid === caller.uid) fail('failed-precondition', '自分自身は削除できません。')
    tx.delete(memberRef(db, orgId, targetUid))
    writeAuditLog(tx, db, orgId, 'member.delete', caller.uid, { targetUid })
  })
}

export async function updateOrganizationNameFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const name = requireString(input.name, '組織名', 100)

  await db.runTransaction(async (tx) => {
    await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner'], tx)
    tx.update(orgRef(db, orgId), { name, updatedAt: FieldValue.serverTimestamp() })
    writeAuditLog(tx, db, orgId, 'organization.updateName', caller.uid, { name })
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（20 件 + members 4 件 = 24 件）

- [ ] **Step 5: callable を公開する**

`functions/src/index.ts` を次の内容にする（既存の初期化と `Hellow` はそのまま）。

```ts
import { setGlobalOptions } from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { callable, publicCallable } from "./shared/callable";
import { createOrganizationFunc } from "./identity/createOrganization";
import {
  createInvitationFunc,
  getInvitationFunc,
  updateInvitationAcceptFunc,
  updateInvitationRevokeFunc,
} from "./identity/invitations";
import { deleteMemberFunc, updateMemberRoleFunc, updateOrganizationNameFunc } from "./identity/members";

const env = process.env;
const serviceAccount = require("../serviceAccount.json");

initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
  storageBucket: env.STORAGE_BUCKET,
});

setGlobalOptions({ region: "asia-northeast1" });

export const Hellow = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 3600
  },
   (req, res) => {
    console.log("Hellow")
  }
)

// identity/ … 組織・招待・メンバー（docs/04-features.md F-01, F-03）
export const createOrganization = callable(createOrganizationFunc);
export const createInvitation = callable(createInvitationFunc);
export const getInvitation = publicCallable(getInvitationFunc);
export const updateInvitationAccept = callable(updateInvitationAcceptFunc);
export const updateInvitationRevoke = callable(updateInvitationRevokeFunc);
export const updateMemberRole = callable(updateMemberRoleFunc);
export const deleteMember = callable(deleteMemberFunc);
export const updateOrganizationName = callable(updateOrganizationNameFunc);
```

- [ ] **Step 6: ビルドと単体テストを確認する**

Run: `cd functions && npm run build && npm test`
Expected: ビルド成功、単体テスト 44 件 PASS

---

### Task 5: Firestore ルールとインデックス

**Files:**
- Modify: `firestore.rules`、`firestore.indexes.json`
- Modify: `functions/package.json`（devDependencies: `@firebase/rules-unit-testing@^5`、`firebase@^12`）
- Test: `functions/src/__tests__/firestore.rules.itest.ts`

**Interfaces:**
- Consumes: なし（ルールはドキュメントの形だけに依存。`members` は `orgId` / `uid` / `role` / `storeIds` を持つ）
- Produces: クライアントが使えるクエリ
  - `doc('users/{自分}')`
  - `query(collectionGroup('members'), where('uid', '==', 自分))`
  - `doc('organizations/{orgId}')` / `collection('organizations/{orgId}/members')`（メンバー）
  - `collection('organizations/{orgId}/invitations')` / `collection('organizations/{orgId}/googleConnections')`（owner / admin）
  - `collection('organizations/{orgId}/stores')`（owner / admin）、`query(collection(...stores), where(documentId(), 'in', 担当店舗))`（staff）

- [ ] **Step 1: 依存を追加する**

Run: `cd functions && npm install -D @firebase/rules-unit-testing@^5 firebase@^12`
Expected: devDependencies に 2 つが入る

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/__tests__/firestore.rules.itest.ts`:

```ts
import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { TEST_PROJECT_ID } from './emulator'

let env: RulesTestEnvironment

before(async () => {
  env = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    // lib-test/__tests__ から見たリポジトリ直下の firestore.rules
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
  })
})

after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const members: [string, string, string, string[]][] = [
      ['org-a', 'u-owner', 'owner', []],
      ['org-a', 'u-admin', 'admin', []],
      ['org-a', 'u-staff', 'staff', ['st-1']],
      ['org-b', 'u-other', 'owner', []],
    ]
    await setDoc(doc(db, 'users/u-owner'), { email: 'owner@example.com', displayName: 'Owner', platformRole: null })
    await setDoc(doc(db, 'organizations/org-a'), { type: 'corporate', name: 'A', status: 'active', ownerUid: 'u-owner' })
    await setDoc(doc(db, 'organizations/org-b'), { type: 'individual', name: 'B', status: 'active', ownerUid: 'u-other' })
    for (const [orgId, uid, role, storeIds] of members) {
      await setDoc(doc(db, `organizations/${orgId}/members/${uid}`), { orgId, uid, role, storeIds })
    }
    await setDoc(doc(db, 'organizations/org-a/stores/st-1'), { name: '渋谷店' })
    await setDoc(doc(db, 'organizations/org-a/stores/st-2'), { name: '新宿店' })
    await setDoc(doc(db, 'organizations/org-a/invitations/inv-1'), { email: 'x@example.com', status: 'pending' })
    await setDoc(doc(db, 'organizations/org-a/googleConnections/c-1'), { status: 'active' })
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-1'), { title: 'x' })
    await setDoc(doc(db, 'oauthTokens/c-1'), { encryptedRefreshToken: 'x' })
    await setDoc(doc(db, 'oauthStates/s-1'), { orgId: 'org-a' })
    await setDoc(doc(db, 'oauthClientSecrets/org-a'), { encryptedClientSecret: 'x' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anonymous = () => env.unauthenticatedContext().firestore()

test('users: 本人だけ読める。platformRole は変更できない', async () => {
  await assertSucceeds(getDoc(doc(as('u-owner'), 'users/u-owner')))
  await assertFails(getDoc(doc(as('u-admin'), 'users/u-owner')))
  await assertFails(getDoc(doc(anonymous(), 'users/u-owner')))
  await assertSucceeds(updateDoc(doc(as('u-owner'), 'users/u-owner'), { displayName: '新しい名前' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'users/u-owner'), { platformRole: 'operator' }))
})

test('organizations: メンバーだけ読める。書き込みは全員不可', async () => {
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a')))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a')))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a'), { name: 'x' }))
})

test('members: 同じ組織のメンバーは一覧を読める。他組織は不可。書き込みは不可', async () => {
  await assertSucceeds(getDocs(collection(as('u-staff'), 'organizations/org-a/members')))
  await assertFails(getDocs(collection(as('u-other'), 'organizations/org-a/members')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/members/u-new'), { orgId: 'org-a', uid: 'u-new', role: 'owner' }))
})

test('members（collection group）: 自分の所属だけを uid で絞り込めば読める', async () => {
  await assertSucceeds(getDocs(query(collectionGroup(as('u-owner'), 'members'), where('uid', '==', 'u-owner'))))
  await assertFails(getDocs(query(collectionGroup(as('u-owner'), 'members'), where('uid', '==', 'u-other'))))
  await assertFails(getDocs(collectionGroup(as('u-owner'), 'members')))
})

test('invitations / googleConnections: owner・admin のみ読める', async () => {
  for (const path of ['organizations/org-a/invitations', 'organizations/org-a/googleConnections']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertSucceeds(getDocs(collection(as('u-admin'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
  }
})

test('stores: owner は全店舗、staff は担当店舗だけ読める', async () => {
  await assertSucceeds(getDocs(collection(as('u-owner'), 'organizations/org-a/stores')))
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/stores/st-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/stores/st-2')))
  await assertFails(getDocs(collection(as('u-staff'), 'organizations/org-a/stores')))
  await assertSucceeds(getDocs(query(collection(as('u-staff'), 'organizations/org-a/stores'), where(documentId(), 'in', ['st-1']))))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a/stores/st-1')))
})

test('秘密のコレクションと未対応のコレクションは誰も読めない', async () => {
  await assertFails(getDoc(doc(as('u-owner'), 'oauthTokens/c-1')))
  await assertFails(getDoc(doc(as('u-owner'), 'oauthStates/s-1')))
  await assertFails(getDoc(doc(as('u-owner'), 'oauthClientSecrets/org-a')))
  await assertFails(getDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-1')))
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（現行ルールは全拒否のため `assertSucceeds` の項目が失敗）

- [ ] **Step 4: ルールを書く**

`firestore.rules`:

```
rules_version = '2';

// docs/02-database.md 5 章のうち、基盤（組織・メンバー・招待・連携・店舗）の読み取り規則。
// 書き込みはすべて Functions（Admin SDK）経由のため、ここでは許可しない（users の本人更新のみ例外）。
// ここに無いコレクションはすべて拒否される。
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }

    function memberPath(orgId) {
      return /databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid);
    }

    function isMember(orgId) {
      return isSignedIn() && exists(memberPath(orgId));
    }

    // メンバー判定とロール判定を get() 1 回にまとめる
    function hasRole(orgId, roles) {
      return isMember(orgId) && get(memberPath(orgId)).data.role in roles;
    }

    function canReadStore(orgId, storeId) {
      let member = get(memberPath(orgId)).data;
      return member.role in ['owner', 'admin'] || storeId in member.storeIds;
    }

    match /users/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
      allow update: if isSignedIn() && request.auth.uid == uid
        && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['platformRole']);
    }

    // 自分の所属組織の一覧（collectionGroup('members') を uid で絞り込む）
    match /{path=**}/members/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
    }

    match /organizations/{orgId} {
      allow read: if isMember(orgId);

      match /members/{uid} {
        allow read: if isMember(orgId);
      }

      match /invitations/{invitationId} {
        allow read: if hasRole(orgId, ['owner', 'admin']);
      }

      match /googleConnections/{connectionId} {
        allow read: if hasRole(orgId, ['owner', 'admin']);
      }

      match /stores/{storeId} {
        allow read: if isMember(orgId) && canReadStore(orgId, storeId);
      }
    }
  }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（24 件 + rules 7 件 = 31 件）

staff の `documentId() in [...]` クエリがルールで拒否された場合は、`canReadStore` を変えずにクライアント側の読み方を「担当店舗を 1 件ずつ `getDoc` / `onSnapshot(doc)`」にする（Task 6 の `watchStores` に反映）。この判断は ledger に Ruling として記録する。

- [ ] **Step 6: インデックスを追加する**

`firestore.indexes.json`:

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "members",
      "fieldPath": "uid",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "invitations",
      "fieldPath": "tokenHash",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

> collection group のクエリは、単一フィールドでも collection group スコープのインデックスが必要（Emulator はインデックスを強制しないため、本番デプロイ前にこの設定が必須）。

---

### Task 6: クライアントのモード切替と Firestore 同期

**Files:**
- Modify: `nuxt.config.ts`、`app/plugins/firebase.client.ts`
- Create: `app/utils/firebase/emptyDb.ts`、`converters.ts`、`mirror.ts`、`callFunction.ts`
- Create: `app/composables/useAppDb.ts`、`useBackendReady.ts`、`useFirestoreSync.ts`
- Create: `app/plugins/firestore-sync.client.ts`
- Create: `.env.example`（ルート。キー名のみ）

**Interfaces:**
- Consumes: Task 5 のクエリ
- Produces:
  - `useRuntimeConfig().public.useMock: boolean` / `useEmulator: boolean`
  - `useAppDb(): Ref<MockDb>`（モック: `useMockDb()`、本物: Firestore を流し込んだ DB）
  - `useBackendReady(): { state: Ref<{ isAuthReady: boolean; isOrgsReady: boolean }>; waitForAuth(): Promise<void>; waitForOrgs(): Promise<void>; waitForOrg(orgId: string, timeoutMs?: number): Promise<void> }`
  - `startFirestoreSync(): void` / `refreshAuthUser(): void`
  - `callFunction<TReq, TRes>(functions: Functions, name: string, data: TReq): Promise<TRes>`（失敗時は `Error(画面表示用メッセージ)`）
  - converters: `toIso(value: unknown): string` / `toUser(authUser): User` / `toOrganization(id, data): Organization` / `toMember(data): Member` / `toInvitation(id, data): Invitation` / `toStore(id, orgId, data): Store` / `toGoogleConnection(id, orgId, data): GoogleConnection`

- [ ] **Step 1: ベースラインを確認する**

Run: `npm run typecheck`（ルート）
Expected: エラーなし。エラーが出る場合は内容を ledger に記録し、本タスクで増えたエラーだけを対象にする

- [ ] **Step 2: 設定を追加する**

`nuxt.config.ts` の `runtimeConfig.public` の先頭に追加する。

```ts
      // false で Firebase に本接続する（既定はモック）。対象は認証・組織・メンバー（docs/superpowers/specs/2026-10-07-gbp-integration-design.md 3.1）
      useMock: process.env.NUXT_PUBLIC_USE_MOCK !== 'false',
      // true でクライアントを Firebase Emulator に接続する
      useEmulator: process.env.NUXT_PUBLIC_USE_EMULATOR === 'true',
```

`.env.example`（新規。値は空）:

```
# Firebase設定
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=

# false で Firebase に本接続（既定はモック）
NUXT_PUBLIC_USE_MOCK=
# true で Firebase Emulator に接続
NUXT_PUBLIC_USE_EMULATOR=
```

`app/plugins/firebase.client.ts` の import に Emulator 接続関数を加え、`getFunctions` の後に接続処理を入れる。

```ts
import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
```

```ts
  const functions = getFunctions(firebaseApp, "asia-northeast1");

  // ポートは firebase.json の emulators と合わせる
  if (config.public.useEmulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
```

- [ ] **Step 3: 変換・集約・呼び出しの utility を作る**

`app/utils/firebase/emptyDb.ts`:

```ts
import type { MockDb } from '~/utils/mock/seed'

/** 本物モードの DB の初期値。Firestore の購読結果で埋めていく */
export function createEmptyDb(): MockDb {
  return {
    users: [],
    organizations: [],
    members: [],
    invitations: [],
    googleConnections: [],
    gbpLocations: [],
    stores: [],
    surveys: [],
    surveyVersions: [],
    publicSurveys: [],
    responses: [],
    rankKeywords: [],
    rankSnapshots: [],
    usage: [],
  }
}
```

`app/utils/firebase/converters.ts`:

```ts
import type { User as AuthUser } from 'firebase/auth'
import type { DocumentData } from 'firebase/firestore'
import type { GoogleConnection, Invitation, Member, Organization, Store, User } from '~/types/domain'

// Firestore のドキュメントを app/types/domain.ts の型（日時は ISO 文字列）に変換する。

/** Timestamp / Date / ISO 文字列を ISO 文字列にする。サーバー時刻の確定前（null）は現在時刻 */
export function toIso(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
}

export function toUser(authUser: AuthUser): User {
  return {
    uid: authUser.uid,
    email: (authUser.email ?? '').toLowerCase(),
    displayName: authUser.displayName ?? authUser.email ?? '',
    isOperator: false,
  }
}

export function toOrganization(id: string, data: DocumentData): Organization {
  return {
    id,
    type: data.type,
    name: data.name,
    plan: data.plan,
    status: data.status,
    limits: data.limits,
    ownerUid: data.ownerUid,
    createdAt: toIso(data.createdAt),
  }
}

export function toMember(data: DocumentData): Member {
  return {
    orgId: data.orgId,
    uid: data.uid,
    role: data.role,
    storeIds: data.storeIds ?? [],
    email: data.email,
    displayName: data.displayName,
    joinedAt: toIso(data.joinedAt),
  }
}

/** 保存しているのはトークンのハッシュだけなので token は空文字（URL は作成直後にだけ表示できる） */
export function toInvitation(id: string, data: DocumentData): Invitation {
  return {
    id,
    orgId: data.orgId,
    email: data.email,
    role: data.role,
    storeIds: data.storeIds ?? [],
    status: data.status,
    token: '',
    expiresAt: toIso(data.expiresAt),
    invitedBy: data.invitedBy,
    createdAt: toIso(data.createdAt),
  }
}

export function toStore(id: string, orgId: string, data: DocumentData): Store {
  return {
    id,
    orgId,
    name: data.name,
    address: data.address ?? '',
    lat: data.location?.latitude ?? 0,
    lng: data.location?.longitude ?? 0,
    connectionId: data.connectionId ?? null,
    gbpLocationName: data.gbpLocationName ?? null,
    placeId: data.placeId ?? '',
    reviewUrl: data.reviewUrl ?? '',
    status: data.status ?? 'active',
  }
}

export function toGoogleConnection(id: string, orgId: string, data: DocumentData): GoogleConnection {
  return {
    id,
    orgId,
    googleEmail: data.googleEmail,
    gbpAccounts: data.gbpAccounts ?? [],
    status: data.status,
    lastError: data.lastError ?? null,
    connectedAt: toIso(data.connectedAt ?? data.createdAt),
  }
}
```

`app/utils/firebase/mirror.ts`:

```ts
/**
 * 複数の購読（例: 自分の所属一覧と、表示中の組織のメンバー一覧）の結果を 1 つの配列にまとめる。
 * 同じキーの要素は後から登録した購読の値で上書きする。
 */
export class MirrorCollection<T> {
  private readonly sources = new Map<string, T[]>()

  constructor(
    private readonly keyOf: (item: T) => string,
    private readonly publish: (items: T[]) => void,
  ) {}

  set(source: string, items: T[]): void {
    this.sources.set(source, items)
    this.flush()
  }

  delete(source: string): void {
    if (this.sources.delete(source)) this.flush()
  }

  clear(): void {
    this.sources.clear()
    this.flush()
  }

  private flush(): void {
    const merged = new Map<string, T>()
    for (const items of this.sources.values()) {
      for (const item of items) merged.set(this.keyOf(item), item)
    }
    this.publish([...merged.values()])
  }
}
```

`app/utils/firebase/callFunction.ts`:

```ts
import { FirebaseError } from 'firebase/app'
import { httpsCallable, type Functions } from 'firebase/functions'

const FALLBACK_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。'

/**
 * callable Functions を呼ぶ。HttpsError のメッセージ（日本語）をそのまま画面に出せる Error にして投げる。
 * 想定外のエラー（functions/internal など）は汎用メッセージにする。
 */
export async function callFunction<TReq, TRes>(functions: Functions, name: string, data: TReq): Promise<TRes> {
  try {
    const result = await httpsCallable<TReq, TRes>(functions, name)(data)
    return result.data
  }
  catch (error) {
    const isServerMessage = error instanceof FirebaseError && error.code !== 'functions/internal' && error.code !== 'functions/unavailable'
    throw new Error(isServerMessage ? error.message : FALLBACK_MESSAGE, { cause: error })
  }
}
```

- [ ] **Step 4: DB・待機・同期の composable を作る**

`app/composables/useAppDb.ts`:

```ts
import type { MockDb } from '~/utils/mock/seed'
import { createEmptyDb } from '~/utils/firebase/emptyDb'

/**
 * 画面が読むリアクティブ DB。モックでは仮データ、本物では Firestore を購読して流し込んだもの。
 * どちらも同じ形なので、読み取り側の computed はモードを意識しない。
 */
export function useAppDb() {
  if (useRuntimeConfig().public.useMock) return useMockDb()
  return useState<MockDb>('firestore-db', createEmptyDb)
}
```

`app/composables/useBackendReady.ts`:

```ts
// 本物モードで、認証状態と所属組織の初回読み込みが終わったかを持つ。ミドルウェアはこれを待ってから判定する。

interface BackendReadyState {
  isAuthReady: boolean
  isOrgsReady: boolean
}

function waitUntil(isDone: () => boolean, timeoutMs?: number): Promise<void> {
  if (isDone()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => { stop(); reject(new Error('読み込みがタイムアウトしました。ページを再読み込みしてください。')) }, timeoutMs) : null
    const stop = watch(isDone, (value) => {
      if (!value) return
      stop()
      if (timer) clearTimeout(timer)
      resolve()
    })
  })
}

export function useBackendReady() {
  const isMock = useRuntimeConfig().public.useMock
  const state = useState<BackendReadyState>('backend-ready', () => ({ isAuthReady: isMock, isOrgsReady: isMock }))
  const db = useAppDb()

  return {
    state,
    waitForAuth: () => waitUntil(() => state.value.isAuthReady),
    waitForOrgs: () => waitUntil(() => state.value.isOrgsReady),
    /** 作成・受諾した組織が購読に届くまで待つ（直後の画面遷移でミドルウェアに弾かれないように） */
    waitForOrg: (orgId: string, timeoutMs = 10_000) =>
      waitUntil(() => db.value.organizations.some(org => org.id === orgId)
        && db.value.members.some(member => member.orgId === orgId && member.uid === db.value.users[0]?.uid), timeoutMs),
  }
}
```

`app/composables/useFirestoreSync.ts`:

```ts
import { onAuthStateChanged } from 'firebase/auth'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import type { GoogleConnection, Invitation, Member, Organization, Store } from '~/types/domain'
import { toGoogleConnection, toInvitation, toMember, toOrganization, toStore, toUser } from '~/utils/firebase/converters'
import { createEmptyDb } from '~/utils/firebase/emptyDb'
import { MirrorCollection } from '~/utils/firebase/mirror'

// 本物モードで Firestore を購読し、useAppDb() の DB に流し込む。
// ・ログインユーザー: 自分の所属（collectionGroup members）と所属組織のドキュメント
// ・表示中の組織: メンバー・店舗、owner / admin なら招待と Google 連携も

/** documentId() の in は 30 件まで */
const IN_QUERY_LIMIT = 30

function stopAll(unsubscribes: Unsubscribe[]): void {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes.length = 0
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

/** ログイン直後の表示名の更新（updateProfile）は onAuthStateChanged が発火しないため、手動で反映する */
export function refreshAuthUser(): void {
  const { $auth } = useNuxtApp()
  const db = useAppDb()
  if ($auth.currentUser) db.value.users = [toUser($auth.currentUser)]
}

export function startFirestoreSync(): void {
  const { $auth, $db } = useNuxtApp()
  const firestore = $db as Firestore
  const db = useAppDb()
  const { state } = useBackendReady()
  const router = useRouter()

  const organizations = new MirrorCollection<Organization>(item => item.id, items => { db.value.organizations = items })
  const members = new MirrorCollection<Member>(item => `${item.orgId}/${item.uid}`, items => { db.value.members = items })
  const stores = new MirrorCollection<Store>(item => item.id, items => { db.value.stores = items })
  const invitations = new MirrorCollection<Invitation>(item => item.id, items => { db.value.invitations = items })
  const connections = new MirrorCollection<GoogleConnection>(item => item.id, items => { db.value.googleConnections = items })

  const userSubscriptions: Unsubscribe[] = []
  const orgDocSubscriptions = new Map<string, Unsubscribe>()
  const currentOrgSubscriptions: Unsubscribe[] = []

  function resetAll(): void {
    stopAll(userSubscriptions)
    stopAll(currentOrgSubscriptions)
    for (const unsubscribe of orgDocSubscriptions.values()) unsubscribe()
    orgDocSubscriptions.clear()
    for (const mirror of [organizations, members, stores, invitations, connections]) mirror.clear()
    db.value = createEmptyDb()
  }

  /** 所属組織のドキュメントを、所属の増減に合わせて購読・解除する */
  function syncOrgDocs(orgIds: string[]): void {
    for (const [orgId, unsubscribe] of orgDocSubscriptions) {
      if (orgIds.includes(orgId)) continue
      unsubscribe()
      orgDocSubscriptions.delete(orgId)
      organizations.delete(orgId)
    }
    for (const orgId of orgIds) {
      if (orgDocSubscriptions.has(orgId)) continue
      orgDocSubscriptions.set(orgId, onSnapshot(doc(firestore, `organizations/${orgId}`), (snapshot) => {
        organizations.set(orgId, snapshot.exists() ? [toOrganization(snapshot.id, snapshot.data())] : [])
      }))
    }
  }

  function watchMemberships(uid: string): void {
    const membershipQuery = query(collectionGroup(firestore, 'members'), where('uid', '==', uid))
    userSubscriptions.push(onSnapshot(membershipQuery, (snapshot) => {
      const mine = snapshot.docs.map(item => toMember(item.data()))
      members.set('mine', mine)
      syncOrgDocs(mine.map(member => member.orgId))
      state.value.isOrgsReady = true
    }, () => {
      state.value.isOrgsReady = true
    }))
  }

  function watchStores(orgId: string, member: Member): void {
    const storesPath = `organizations/${orgId}/stores`
    if (member.role !== 'staff') {
      currentOrgSubscriptions.push(onSnapshot(collection(firestore, storesPath), (snapshot) => {
        stores.set('current', snapshot.docs.map(item => toStore(item.id, orgId, item.data())))
      }))
      return
    }
    // staff は担当店舗だけを documentId で絞り込む（ルールが担当外の読み取りを拒否するため）
    const chunks = chunk(member.storeIds, IN_QUERY_LIMIT)
    stores.set('current', [])
    chunks.forEach((storeIds, index) => {
      currentOrgSubscriptions.push(onSnapshot(query(collection(firestore, storesPath), where(documentId(), 'in', storeIds)), (snapshot) => {
        stores.set(`current-${index}`, snapshot.docs.map(item => toStore(item.id, orgId, item.data())))
      }))
    })
  }

  function watchCurrentOrg(orgId: string, member: Member | null): void {
    stopAll(currentOrgSubscriptions)
    for (const mirror of [stores, invitations, connections]) mirror.clear()
    members.delete('current')
    if (!orgId || !member) return

    currentOrgSubscriptions.push(onSnapshot(collection(firestore, `organizations/${orgId}/members`), (snapshot) => {
      members.set('current', snapshot.docs.map(item => toMember(item.data())))
    }))
    watchStores(orgId, member)
    if (member.role === 'staff') return
    currentOrgSubscriptions.push(onSnapshot(collection(firestore, `organizations/${orgId}/invitations`), (snapshot) => {
      invitations.set('current', snapshot.docs.map(item => toInvitation(item.id, item.data())))
    }))
    currentOrgSubscriptions.push(onSnapshot(collection(firestore, `organizations/${orgId}/googleConnections`), (snapshot) => {
      connections.set('current', snapshot.docs.map(item => toGoogleConnection(item.id, orgId, item.data())))
    }))
  }

  onAuthStateChanged($auth, (authUser) => {
    resetAll()
    state.value.isOrgsReady = false
    if (!authUser) {
      state.value.isAuthReady = true
      state.value.isOrgsReady = true
      return
    }
    db.value.users = [toUser(authUser)]
    state.value.isAuthReady = true
    watchMemberships(authUser.uid)
  })

  // 表示中の組織・自分のロール・担当店舗が変わったら購読し直す
  watch(
    () => {
      const orgId = String(router.currentRoute.value.params.orgId ?? '')
      const uid = db.value.users[0]?.uid
      const member = db.value.members.find(item => item.orgId === orgId && item.uid === uid) ?? null
      return { orgId, member, key: `${orgId}|${member?.role}|${member?.storeIds.join(',')}` }
    },
    (next, previous) => {
      if (next.key !== previous?.key) watchCurrentOrg(next.orgId, next.member)
    },
    { immediate: true },
  )
}
```

`app/plugins/firestore-sync.client.ts`（`firebase.client.ts` の後に読み込まれるよう、ファイル名の順序に依存する）:

```ts
// 本物モードのときだけ Firestore の購読を始める（firebase.client.ts の初期化後に動く）
export default defineNuxtPlugin(() => {
  if (useRuntimeConfig().public.useMock) return
  startFirestoreSync()
})
```

- [ ] **Step 5: 型チェックを確認する**

Run: `npm run typecheck`
Expected: Step 1 のベースラインから新しいエラーが増えていない

---

### Task 7: 認証とミドルウェアのモード分岐

**Files:**
- Create: `app/utils/firebase/authErrors.ts`
- Modify: `app/composables/useAuth.ts`
- Modify: `app/middleware/auth.global.ts`、`app/middleware/org-access.global.ts`
- Modify: `app/pages/login.vue`

**Interfaces:**
- Consumes: Task 6 の `useAppDb` / `useBackendReady` / `refreshAuthUser` / `callFunction`
- Produces: `useAuth()` の戻り値は変えない（`{ user, isLoggedIn, login, loginAs, logout, signup, registerUser, requestPasswordReset }`）。`logout()` は `Promise<void>` を返すようになる（呼び出し側は戻り値を使っていないため影響なし）

- [ ] **Step 1: Auth のエラー変換を作る**

`app/utils/firebase/authErrors.ts`:

```ts
import { FirebaseError } from 'firebase/app'

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。',
  'auth/weak-password': 'パスワードは 8 文字以上にしてください。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてから再度お試しください。',
  'auth/network-request-failed': '通信に失敗しました。接続を確認して再度お試しください。',
}

/** Firebase Auth のエラーを画面表示用の Error にする */
export function toAuthError(error: unknown): Error {
  const message = error instanceof FirebaseError ? MESSAGES[error.code] : undefined
  return new Error(message ?? '認証に失敗しました。時間をおいて再度お試しください。', { cause: error })
}
```

- [ ] **Step 2: `useAuth` に本物モードを追加する**

`app/composables/useAuth.ts` の import に追加する。

```ts
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { callFunction } from '~/utils/firebase/callFunction'
import { toAuthError } from '~/utils/firebase/authErrors'
```

`useAuth()` の本体を次のように置き換える（モックの処理は `if (isMock)` の中に、既存コードをそのまま残す）。

```ts
export function useAuth() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { $auth, $functions } = useNuxtApp()
  const { waitForOrg } = useBackendReady()
  const uid = useState<string | null>('auth-uid', () => (isMock ? readStoredUid() : null))

  // 本物モードでは users に自分 1 人だけが入る（useFirestoreSync）
  const user = computed<User | null>(() =>
    isMock ? db.value.users.find(item => item.uid === uid.value) ?? null : db.value.users[0] ?? null)
  const isLoggedIn = computed(() => user.value !== null)

  function setUid(value: string | null): void {
    uid.value = value
    writeStoredUid(value)
  }

  function validatePassword(password: string): void {
    if (password.length < 8) throw new MockFunctionsError('invalid-argument', 'パスワードは 8 文字以上にしてください。')
  }

  /** Firebase Auth でアカウントを作り、表示名を設定する */
  async function createFirebaseUser(input: { displayName: string; email: string; password: string }): Promise<void> {
    validatePassword(input.password)
    try {
      const credential = await createUserWithEmailAndPassword($auth, input.email.trim(), input.password)
      await updateProfile(credential.user, { displayName: input.displayName.trim() })
    }
    catch (error) {
      throw toAuthError(error)
    }
    refreshAuthUser()
  }

  async function login(email: string, password: string): Promise<void> {
    if (!isMock) {
      try {
        await signInWithEmailAndPassword($auth, email.trim(), password)
      }
      catch (error) {
        throw toAuthError(error)
      }
      return
    }
    await mockLatency()
    const found = db.value.users.find(item => item.email === email.trim().toLowerCase())
    if (!found || password !== DEMO_PASSWORD) {
      throw new MockFunctionsError('unauthenticated', 'メールアドレスまたはパスワードが正しくありません。')
    }
    setUid(found.uid)
  }

  /** デモ用: パスワードなしで指定ユーザーとしてログインする（モックのみ） */
  function loginAs(targetUid: string): void {
    setUid(targetUid)
  }

  async function logout(): Promise<void> {
    if (!isMock) {
      await signOut($auth)
      return
    }
    setUid(null)
  }

  /** アカウントと組織をまとめて作成し、作成した組織 ID を返す */
  async function signup(input: SignupInput): Promise<string> {
    if (!isMock) {
      await createFirebaseUser(input)
      const { orgId } = await callFunction<object, { orgId: string }>($functions, 'createOrganization', {
        requestId: crypto.randomUUID(),
        type: input.type,
        orgName: input.orgName.trim(),
        displayName: input.displayName.trim(),
      })
      await waitForOrg(orgId)
      return orgId
    }
    await mockLatency()
    const email = input.email.trim().toLowerCase()
    if (db.value.users.some(item => item.email === email)) {
      throw new MockFunctionsError('already-exists', 'このメールアドレスはすでに登録されています。')
    }
    validatePassword(input.password)

    const newUser: User = { uid: createId('u'), email, displayName: input.displayName.trim(), isOperator: false }
    db.value.users.push(newUser)
    const orgId = createOrganizationFunc(db.value, {
      uid: newUser.uid,
      email,
      displayName: newUser.displayName,
      type: input.type,
      orgName: input.orgName.trim(),
    })
    setUid(newUser.uid)
    return orgId
  }

  /** 招待から参加する人向け: 組織を作らずにアカウントだけ作成してログインする */
  async function registerUser(input: { displayName: string; email: string; password: string }): Promise<void> {
    if (!isMock) {
      await createFirebaseUser(input)
      return
    }
    await mockLatency()
    const email = input.email.trim().toLowerCase()
    if (db.value.users.some(item => item.email === email)) {
      throw new MockFunctionsError('already-exists', 'このメールアドレスはすでに登録されています。ログインしてください。')
    }
    validatePassword(input.password)
    const newUser: User = { uid: createId('u'), email, displayName: input.displayName.trim(), isOperator: false }
    db.value.users.push(newUser)
    setUid(newUser.uid)
  }

  async function requestPasswordReset(email: string): Promise<void> {
    if (!isMock) {
      try {
        await sendPasswordResetEmail($auth, email.trim())
      }
      catch (error) {
        // 登録有無が分からないよう、存在しないメールでも成功扱いにする
        if (error instanceof FirebaseError && error.code === 'auth/user-not-found') return
        throw toAuthError(error)
      }
      return
    }
    await mockLatency()
    void email
  }

  return { user, isLoggedIn, login, loginAs, logout, signup, registerUser, requestPasswordReset }
}
```

> モックの `signup` / `registerUser` は、既存コードのパスワード長チェックを `validatePassword` に置き換えただけで、順序とメッセージは同じ。

- [ ] **Step 3: ミドルウェアを初回読み込み待ちにする**

`app/middleware/auth.global.ts`:

```ts
// 管理画面・組織選択・運営画面は要ログイン。未ログインならログイン後に元のページへ戻す。
const PROTECTED_PREFIXES = ['/admin', '/orgs', '/ops']

export default defineNuxtRouteMiddleware(async (to) => {
  if (!PROTECTED_PREFIXES.some(prefix => to.path.startsWith(prefix))) return
  // 本物モードでは Firebase Auth の状態が確定するまで待つ（再読み込み直後は未確定）
  await useBackendReady().waitForAuth()
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
```

`app/middleware/org-access.global.ts` の本体を次にする（コメントは既存のまま）。

```ts
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin/')) return
  const orgId = String(to.params.orgId ?? '')
  // 本物モードでは所属組織の初回読み込みを待つ
  await useBackendReady().waitForOrgs()
  const db = useAppDb()
  const { user } = useAuth()

  const org = db.value.organizations.find(item => item.id === orgId)
  const member = db.value.members.find(item => item.orgId === orgId && item.uid === user.value?.uid)
  if (!org || !member || org.status === 'deleted') return navigateTo('/orgs')

  const isAllowed = isAllowedFor({ roles: to.meta.roles, orgTypes: to.meta.orgTypes }, member.role, org.type)
  if (!isAllowed) return navigateTo(`/admin/${orgId}`)
})
```

> 所属は `watchMemberships` が `isOrgsReady` を立てた後に組織ドキュメントが届く。組織ドキュメントが届く前に判定されると `/orgs` に移るが、`/orgs` は再描画で一覧が出るため実害は小さい。Task 9 の E2E で再読み込み直後の `/admin/{orgId}` 直アクセスを確認し、`/orgs` に飛ぶ場合は `isOrgsReady` を「全所属組織のドキュメント初回受信後」に変える（Ruling として記録）。

- [ ] **Step 4: ログイン画面のデモ導線をモック限定にする**

`app/pages/login.vue` の `<script setup>` に追加する。

```ts
const isMock = useRuntimeConfig().public.useMock
```

パスワード欄の `:hint` を次にする。

```vue
        :hint="isMock ? `デモのパスワードは「${DEMO_PASSWORD}」です` : undefined"
```

デモアカウントの `<section>` に `v-if="isMock"` を付ける。

```vue
    <section v-if="isMock" class="space-y-3 border-t border-slate-200 pt-5">
```

- [ ] **Step 5: 型チェックを確認する**

Run: `npm run typecheck`
Expected: ベースラインから新しいエラーが増えていない（`UiInputTextField` の `hint` が `string | undefined` を受けない場合は `''` を渡す）

---

### Task 8: 組織・メンバー・招待の composable と準備中表示

**Files:**
- Modify: `app/composables/useCurrentOrg.ts`、`useMembers.ts`、`useInvitation.ts`、`useStores.ts`、`useAdminNav.ts`
- Create: `app/components/Admin/Layout/ComingSoon.vue`
- Modify: `app/layouts/admin.vue`、`app/components/Admin/Layout/SideNav.vue`
- Modify: `app/pages/admin/[orgId]/settings/members.vue`、`app/pages/invite/[token].vue`

**Interfaces:**
- Consumes: Task 6・7 のすべて
- Produces:
  - `isFirebaseReadyPath(subPath: string): boolean`（`useAdminNav.ts` から export。`subPath` は `/admin/{orgId}` を除いた部分）
  - `useAdminNav().groups` の各 item に `isComingSoon: boolean`
  - `useInvitation(token)` の戻り値に `isLoading: Ref<boolean>` を追加。`org` の型は `{ name: string; type: OrgType } | null`

- [ ] **Step 1: DB の参照を `useAppDb` に置き換える**

`useCurrentOrg.ts`（`useCurrentOrg` と `useMyOrganizations` の両方）、`useMembers.ts`、`useInvitation.ts`、`useStores.ts` の `const db = useMockDb()` を `const db = useAppDb()` に置き換える。

Run: `grep -rn "useMockDb()" app/composables app/middleware`
Expected: `useAppDb.ts`（モック時の委譲）と、本計画の対象外の composable（アンケート・順位・ダッシュボード・運営など）だけが残る

- [ ] **Step 2: 組織名の変更を Functions 経由にする**

`useCurrentOrg.ts` の `useCurrentOrg()` 冒頭に追加する。

```ts
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
```

`import` に追加する。

```ts
import { callFunction } from '~/utils/firebase/callFunction'
```

`updateOrganizationName` を次にする。

```ts
  /** 組織名の変更（owner のみ） */
  async function updateOrganizationName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!org.value || !isOwner.value) throw new Error('組織名を変更する権限がありません。')
    if (trimmed === '') throw new Error('組織名を入力してください。')
    if (!isMock) {
      await callFunction($functions, 'updateOrganizationName', { orgId: orgId.value, name: trimmed })
      return
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    org.value.name = trimmed
  }
```

- [ ] **Step 3: メンバー操作を Functions 経由にする**

`useMembers.ts` に追加・変更する。

```ts
import type { Invitation, MemberRole } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
```

`useMembers()` の冒頭に追加する。

```ts
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
```

4 つの操作を次にする（モックの分岐は既存のまま）。

```ts
  async function invite(input: { email: string; role: Exclude<MemberRole, 'owner'>; storeIds: string[] }): Promise<Invitation> {
    if (!isMock) return callFunction($functions, 'createInvitation', { orgId: orgId.value, ...input })
    await mockLatency()
    return createInvitationFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
  }

  async function revokeInvitation(invitationId: string) {
    if (!isMock) return callFunction<object, void>($functions, 'updateInvitationRevoke', { orgId: orgId.value, invitationId })
    await mockLatency()
    updateInvitationRevokeFunc(db.value, user.value!.uid, orgId.value, invitationId)
  }

  async function updateRole(targetUid: string, role: Exclude<MemberRole, 'owner'>, storeIds: string[]) {
    if (!isMock) return callFunction<object, void>($functions, 'updateMemberRole', { orgId: orgId.value, targetUid, role, storeIds })
    await mockLatency()
    updateMemberRoleFunc(db.value, user.value!.uid, { orgId: orgId.value, targetUid, role, storeIds })
  }

  async function removeMember(targetUid: string) {
    if (!isMock) return callFunction<object, void>($functions, 'deleteMember', { orgId: orgId.value, targetUid })
    await mockLatency()
    deleteMemberFunc(db.value, user.value!.uid, orgId.value, targetUid)
  }
```

`invitationUrl` のコメントを `/** 招待 URL（メールは送らず、画面からコピーして渡す） */` にする。

- [ ] **Step 4: 招待一覧の URL コピーをトークンがあるときだけにする**

`app/pages/admin/[orgId]/settings/members.vue` の 166 行目付近、招待一覧のコピーボタンに `v-if="invitation.token"` を付ける。

```vue
              <UiCommonButton v-if="invitation.token" size="sm" variant="secondary" icon="copy" @click="copyToClipboard(invitationUrl(invitation.token), '招待 URL をコピーしました')">
```

> 本物モードではトークンを保存しないため、URL は作成直後の表示（138 行目付近の `lastInvitation`）でだけコピーできる。紛失した場合は取り消して招待し直す。

- [ ] **Step 5: 招待の確認を Functions 経由にする**

`app/composables/useInvitation.ts` を次にする。

```ts
import type { Invitation, OrgType } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { findInvitationByToken, updateInvitationAcceptFunc } from '~/utils/mock/functions/identity'
import { errorMessageOf, mockLatency } from '~/utils/mock/functions/shared'

// F-03 招待の受諾（/invite/[token]）

interface InvitationLookup {
  invitation: Invitation | null
  org: { name: string; type: OrgType } | null
  storeNames: string[]
  errorMessage: string | null
}

export function useInvitation(token: string) {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { $functions } = useNuxtApp()
  const { waitForOrg } = useBackendReady()

  const mockLookup = computed<InvitationLookup>(() => {
    try {
      const invitation = findInvitationByToken(db.value, token)
      const org = db.value.organizations.find(item => item.id === invitation.orgId) ?? null
      return {
        invitation,
        org: org ? { name: org.name, type: org.type } : null,
        storeNames: invitation.storeIds.map(id => db.value.stores.find(store => store.id === id)?.name ?? id),
        errorMessage: null,
      }
    }
    catch (error) {
      return { invitation: null, org: null, storeNames: [], errorMessage: errorMessageOf(error) }
    }
  })

  const remoteLookup = ref<InvitationLookup>({ invitation: null, org: null, storeNames: [], errorMessage: null })
  const isLoading = ref(!isMock)
  if (!isMock) {
    callFunction<object, { invitation: Invitation; org: { name: string; type: OrgType }; storeNames: string[] }>(
      $functions,
      'getInvitation',
      { token },
    )
      .then((result) => { remoteLookup.value = { ...result, errorMessage: null } })
      .catch((error) => { remoteLookup.value = { invitation: null, org: null, storeNames: [], errorMessage: errorMessageOf(error) } })
      .finally(() => { isLoading.value = false })
  }

  const lookup = computed(() => (isMock ? mockLookup.value : remoteLookup.value))

  /** 受諾して参加した組織 ID を返す */
  async function accept(): Promise<string> {
    if (!isMock) {
      const { orgId } = await callFunction<object, { orgId: string }>($functions, 'updateInvitationAccept', {
        token,
        displayName: user.value?.displayName ?? '',
      })
      await waitForOrg(orgId)
      return orgId
    }
    await mockLatency()
    return updateInvitationAcceptFunc(db.value, user.value!.uid, token)
  }

  return {
    invitation: computed(() => lookup.value.invitation),
    lookupError: computed(() => lookup.value.errorMessage),
    org: computed(() => lookup.value.org),
    storeNames: computed(() => lookup.value.storeNames),
    isLoading,
    accept,
  }
}
```

Run: `grep -n "org\.\|org?\.\|isLoading\|lookupError\|invitation ===\|v-if=\"invitation\|v-else" "app/pages/invite/[token].vue"`
Expected: テンプレートが `org` の `name` / `type` 以外を参照していないこと、読み込み中（`invitation` も `lookupError` も無い状態）の表示箇所が分かること

`app/pages/invite/[token].vue` の分割代入に `isLoading` を加える。

```ts
const { invitation, lookupError, org, storeNames, isLoading, accept } = useInvitation(token)
```

テンプレートの見出し（`<h1>`）の直後に、読み込み中の表示を入れ、既存の最初の分岐（`lookupError` / `invitation` で始まる `v-if`）を `v-else-if` にする。

```vue
    <p v-if="isLoading" class="text-sm text-slate-500">招待を確認しています…</p>
```

`onSwitchAccount` を Promise に合わせる。

```ts
async function onSwitchAccount(): Promise<void> {
  await logout()
}
```

- [ ] **Step 6: 準備中の表示を作る**

`app/composables/useAdminNav.ts` に追加する（`NAV_GROUPS` の前）。

```ts
/**
 * 本物モード（Firebase 接続）で動く管理画面。ここに無い画面は「準備中」を表示する。
 * パスは /admin/{orgId} より後ろの部分。接続した機能を増やしたらここに足す
 */
const FIREBASE_READY_PATHS = ['/settings/organization', '/settings/members']

export function isFirebaseReadyPath(subPath: string): boolean {
  return FIREBASE_READY_PATHS.some(path => subPath === path || subPath.startsWith(`${path}/`))
}
```

`AdminNavItem` の利用側（`useAdminNav()` 内の `groups`）で `isComingSoon` を付ける。

```ts
export function useAdminNav() {
  const { org, role, adminPath } = useCurrentOrg()
  const route = useRoute()
  const isMock = useRuntimeConfig().public.useMock

  const groups = computed(() =>
    NAV_GROUPS.map(group => ({
      label: group.label,
      items: group.items
        .filter(item => isAllowedFor(item, role.value, org.value?.type ?? null))
        .map(item => ({ ...item, to: adminPath(item.path), isComingSoon: !isMock && !isFirebaseReadyPath(item.path) })),
    })).filter(group => group.items.length > 0))
```

（`primaryItems` と `isActive` は変更しない）

`app/components/Admin/Layout/ComingSoon.vue`（新規。`layouts/admin.vue` でのみ使う）:

```vue
<script setup lang="ts">
const { adminPath, isOwner, canManageMembers } = useCurrentOrg()
</script>

<template>
  <section class="mx-auto max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-8 text-center">
    <h1 class="text-lg font-bold text-slate-900">準備中</h1>
    <p class="text-sm text-slate-600">この画面は現在 Firebase との接続を準備しています。公開までしばらくお待ちください。</p>
    <div class="flex flex-wrap justify-center gap-2">
      <UiCommonButton v-if="isOwner" variant="secondary" size="sm" :to="adminPath('/settings/organization')">組織設定</UiCommonButton>
      <UiCommonButton v-if="canManageMembers" variant="secondary" size="sm" :to="adminPath('/settings/members')">メンバー</UiCommonButton>
    </div>
  </section>
</template>
```

> `UiCommonButton` が `to` を受けない場合は `NuxtLink` に既存ボタンと同じクラスを付けて置き換える（`app/components/Ui/Common/Button.vue` の props を確認する）。

`app/layouts/admin.vue`:

```vue
<script setup lang="ts">
const route = useRoute()
const { adminPath } = useCurrentOrg()
const isMock = useRuntimeConfig().public.useMock
/** 本物モードでまだ接続していない画面は、ページ本体を描画せず準備中を出す */
const isComingSoon = computed(() => !isMock && !isFirebaseReadyPath(route.path.slice(adminPath().length)))
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <AdminLayoutHeader />
    <div class="flex">
      <AdminLayoutSideNav />
      <main class="min-w-0 flex-1 px-4 pt-6 pb-28 lg:px-8 lg:pb-12">
        <div class="mx-auto max-w-6xl">
          <AdminLayoutComingSoon v-if="isComingSoon" />
          <slot v-else />
        </div>
      </main>
    </div>
    <AdminLayoutBottomTab />
  </div>
</template>
```

`app/components/Admin/Layout/SideNav.vue` のリンク内、`{{ item.label }}` の後に追加する。

```vue
          <span v-if="item.isComingSoon" class="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">準備中</span>
```

- [ ] **Step 7: 型チェックとモックでの表示を確認する**

Run: `npm run typecheck`
Expected: ベースラインから新しいエラーが増えていない

Run: `npm run dev`（`NUXT_PUBLIC_USE_MOCK` 未設定）でデモアカウント「法人 / オーナー」としてログインし、ダッシュボード・店舗・アンケート・順位・メンバー画面が従来どおり表示され、「準備中」が出ないこと
Expected: 従来と同じ表示

---

### Task 9: Emulator での E2E 確認と PROJECT.md

**Files:**
- Modify: `.claude/PROJECT.md`
- Modify: `functions/.gitignore`（Emulator のログ）

**Interfaces:**
- Consumes: Task 1〜8 のすべて
- Produces: なし（確認と文書）

- [ ] **Step 1: Emulator を起動する**

Run（バックグラウンド）: `cd functions && npm run build && cd .. && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:start --only auth,firestore,functions`
Expected: `All emulators ready!`。Functions に `createOrganization` など 8 つの callable が読み込まれる

> Functions の Emulator は `.firebaserc` の既定プロジェクトで動く。クライアントの `FIREBASE_PROJECT_ID` と同じプロジェクト ID であること（違う場合、クライアントと Functions が別々の Firestore を見る）。

- [ ] **Step 2: 本物モードで dev サーバーを起動する**

Run（バックグラウンド）: `NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=true npm run dev -- --port 3100`
Expected: 起動する

- [ ] **Step 3: 操作を確認する（Playwright MCP またはブラウザ）**

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | `/login` を開く | デモアカウントの欄が無い |
| 2 | `/signup` で法人・組織名・表示名・メール `owner@example.com`・パスワード 8 文字以上で登録 | `/admin/org-...` に遷移し「準備中」が出る（`/orgs` に飛ばされない） |
| 3 | サイドナビ | 組織設定・メンバー以外に「準備中」バッジ |
| 4 | 組織設定で組織名を変更 | 画面とヘッダーの組織名が変わる（Emulator UI の Firestore でも変わっている） |
| 5 | メンバーで `admin2@example.com` を管理者として招待 | 招待 URL が表示される。招待一覧に出るがコピーボタンは無い |
| 6 | ログアウト → 招待 URL を開く | 組織名と権限が表示される |
| 7 | 招待画面で表示名・パスワードを入れて登録して参加 | `/admin/{orgId}` に遷移する |
| 8 | ブラウザを再読み込み | ログイン状態が保たれ、同じ画面に留まる |
| 9 | `/orgs` | 参加した組織が 1 件表示される |
| 10 | owner で再ログインし、メンバー画面で admin2 の権限変更・削除 | 一覧に即時反映される |
| 11 | パスワード違いでログイン | 「メールアドレスまたはパスワードが正しくありません。」 |

失敗した項目は superpowers:systematic-debugging で原因を調べて直し、ledger に記録する。

- [ ] **Step 4: モックモードの退行がないことを確認する**

Run: `npm run dev`（環境変数なし）で、デモアカウント 4 種それぞれでログインし、ダッシュボード・店舗・アンケート・順位・メンバー・運営画面（運営アカウント）が従来どおり表示されること
Expected: 従来と同じ

- [ ] **Step 5: `.claude/PROJECT.md` を MEO-Tool の実構成に書き直す**

`.claude/PROJECT.md` を次の内容にする。

```markdown
# PROJECT

このプロジェクト固有の値をまとめる。汎用ルールは `CLAUDE.md` を見る。
**ここの記述と実物が食い違っていたら、実物を正としてこのファイルを直す。**

## 概要

| 項目 | 値 |
| --- | --- |
| プロジェクト名 | `MEO-Tool`（口コミアンケート・Google ビジネスプロフィール連携・検索順位計測の管理ツール） |
| 構成 | Nuxt 4 SPA（`ssr: false`）+ Tailwind CSS v4 + Firebase（Hosting / Auth / Firestore / Functions） |
| 設計資料 | `docs/`（`README.md` から各資料へ）、`docs/superpowers/specs/` `docs/superpowers/plans/` |
| Firebase プロジェクト | `meo-tool-d98e5`（`.firebaserc`） |

## モード（モック / 本接続）

| 環境変数 | 値 | 意味 |
| --- | --- | --- |
| `NUXT_PUBLIC_USE_MOCK` | 未設定 or `true` | 全画面を `app/utils/mock/` の仮データで動かす |
| | `false` | 認証・組織・メンバーを Firebase に本接続。未接続の画面は「準備中」 |
| `NUXT_PUBLIC_USE_EMULATOR` | `true` | クライアントを Firebase Emulator に接続 |

本接続済みの画面は `app/composables/useAdminNav.ts` の `FIREBASE_READY_PATHS`。

## 公開

| 項目 | 値 |
| --- | --- |
| 配信基盤 | Firebase Hosting（静的配信） |
| publish ディレクトリ | `.output/public`（`firebase.json` の `hosting.public`） |
| 本番ドメイン | <!-- 未記入 --> |

## スタイル

| 項目 | 値 |
| --- | --- |
| Tailwind | **v4 系**（CSS-first）。`tailwind.config.js` は**無い** |
| 接続方法 | `@tailwindcss/vite` を `nuxt.config.ts` の `vite.plugins` に渡す |
| エントリ CSS | `app/assets/css/main.css`（`@import "tailwindcss"` + `@theme`） |

### Tailwind のクラススキャン対象

v4 の既定スキャン範囲（`main.css` からの相対）に従う。`app/` 配下の `.vue` / `.ts` が対象。
**`nuxt.config.ts` や `public/` にクラス文字列を置かない**。

## Functions

| 項目 | 値 |
| --- | --- |
| ソース | `functions/src/`（Node 24 / TypeScript / CommonJS） |
| region | `asia-northeast1`（`setGlobalOptions`） |
| firebase-admin 初期化 | `functions/src/index.ts` で 1 回（`functions/serviceAccount.json` の cert。ファイルは `.gitignore` 済み） |
| フォルダ | `identity/`（組織・招待・メンバー）、`shared/`（権限・検証・監査ログ）、`shared/gbp/`（汎用 GBP クライアント。Firebase 非依存） |
| export 名の規則 | ハンドラー `xxxFunc` → `index.ts` の export は `xxx`（例: `createOrganizationFunc` → `createOrganization`） |
| ハンドラーの形 | `(db, caller, data) => Promise<T>`。`shared/callable.ts` の `callable()` で onCall に包む |

## 秘密情報

`.env`（`.gitignore` 済み）、`functions/serviceAccount.json`（`functions/.gitignore` 済み）。`.env.example` はキー名のみ。

## npm scripts

| 場所 | コマンド | 内容 |
| --- | --- | --- |
| ルート | `npm run dev` | 開発サーバー |
| ルート | `npm run generate` | 静的生成（デプロイ前） |
| ルート | `npm run typecheck` | `nuxt typecheck` |
| ルート | `npm run test:emulator` | Firestore Emulator 上で Functions の結合テストとルールテスト |
| functions | `npm run build` | `tsc`（`lib/` に出力。テストは含まない） |
| functions | `npm test` | 単体テスト（`node:test`、出力先 `lib-test/`） |

Emulator は **Java 21 以上**が必要（このマシンでは Homebrew の `openjdk@21`。keg-only のため `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` を付けて実行する）。

## このプロジェクトで適用外の Skill

| Skill | 理由 |
| --- | --- |
| `firebase-app-hosting-basics` | App Hosting ではなく静的な Firebase Hosting |
| `firebase-data-connect` | Firestore を使っている |
| `xcode-project-setup` | 対象外 |
```

- [ ] **Step 6: 全テストを最終確認する**

Run: `cd functions && npm test && npm run build`、ルートで `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`、`npm run typecheck`
Expected: 単体 44 件 PASS、Emulator 31 件 PASS、ビルド成功、型チェックはベースラインから悪化なし

---

## 完了条件

- `functions` の単体テスト 44 件、Emulator テスト 31 件がすべて PASS
- `npm run typecheck` がベースラインから悪化していない
- `NUXT_PUBLIC_USE_MOCK=false` + Emulator で、新規登録 → 組織名変更 → 招待 → 受諾 → 権限変更・削除が動く
- `NUXT_PUBLIC_USE_MOCK` 未設定で、現行の全画面が従来どおり動く
- `.claude/PROJECT.md` が MEO-Tool の実構成になっている
