# GBP 連携の土台（OAuth クライアント・Google 連携・店舗取込）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織ごとに登録した OAuth クライアントで Google と連携し、GBP のロケーションを店舗として取り込めるようにする。あわせて、計画 4（プロフィール・口コミ・投稿）が使う「連携から `GbpClient` を組み立てる共通処理」を用意する。

**Architecture:** 秘密（OAuth クライアントシークレット・refresh token）は `SecretCipher` で暗号化して全拒否コレクションに保存する（本番は Cloud KMS、Emulator とテストはローカル AES）。外部呼び出し（トークン交換・GBP API・トークン取消）は `GoogleDeps` として注入し、Emulator 上でテストする。クライアントは計画 2 の方式（Firestore 購読 + callable）に乗せ、設定画面と店舗画面を本物モードで動かす。

**Tech Stack:** firebase-functions 7 / firebase-admin 13 / `@google-cloud/kms` / `google-auth-library` 10 / 計画 1 の `GbpClient` / Nuxt 4

**Spec:** `docs/superpowers/specs/2026-10-07-gbp-integration-design.md`（4.1・4.2・6 章）

**前提（計画 1・2 で確定済み）:** `functions/src/shared/gbp/`（`GbpClient` / `createTokenProvider` / `GbpAuthError` / `GbpApiError` / `toV4LocationPath`）、`functions/src/shared/{errors,auth,validation,members,audit,callable}.ts`、Emulator テスト helper（`getTestDb` / `clearFirestore` / `caller` / `seedOrg` / `seedStore`）、クライアントの `useAppDb` / `useFirestoreSync` / `callFunction` / `FIREBASE_READY_PATHS`

## Global Constraints

- 秘密は平文で Firestore に置かない。`oauthClientSecrets/{orgId}`・`oauthTokens/{connectionId}`・`oauthStates/{state}` はルールで全拒否（計画 2 で設定済み）
- 暗号方式の選択: `SECRET_CIPHER=local` または `FUNCTIONS_EMULATOR=true` ならローカル AES、それ以外は `KMS_KEY_NAME` 必須（未設定なら `failed-precondition`）
- Functions の環境変数: `OAUTH_CALLBACK_URL`（`googleOAuthCallback` の URL）、`ADMIN_APP_URL`（コールバック後の戻り先のオリジン）、`KMS_KEY_NAME`
- OAuth のスコープ: `https://www.googleapis.com/auth/business.manage`・`openid`・`email`。`access_type=offline`・`prompt=consent`
- state は 10 分で失効し、1 回しか使えない
- 同じ組織で同じ Google アカウントを連携し直したら、既存の連携を更新する（再認証）
- 店舗のドキュメント ID は `st-{ロケーション ID}`（`locations/123` → `st-123`）
- 権限: OAuth クライアントの登録・削除は owner、連携・解除・取込・アーカイブは owner / admin
- callable の export 名はハンドラー名から `Func` を除いたもの。region は `asia-northeast1`
- モック（`NUXT_PUBLIC_USE_MOCK` 未設定）の挙動を壊さない
- コミットはユーザーの許可がある場合のみ（現状: その場で実装・コミットなし）

## Review Focus

- **state の再利用・期限切れ・別組織**: 同じ state で 2 回コールバックしても 2 つ目は失敗し、連携は 1 つだけ → Task 3 のテスト
- **refresh token が返らない同意**（以前に同意済みで `prompt=consent` が効かない場合など）: 連携を作らず、原因が分かるエラーで設定画面に戻す → Task 3 のテスト
- **連携が残っているのに OAuth クライアントを削除**: 削除を拒否する（残った連携が復号できなくなるため） → Task 2 のテスト
- **1 つの連携だけトークン失効**: その連携を `error` にし、他の連携のロケーションは返す → Task 5 のテスト
- **同じロケーションを 2 回取り込む・上限ちょうど**: 重複しない、上限を超える取込は全体を拒否 → Task 5 のテスト

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `functions/src/shared/secrets.ts` | `SecretCipher`（KMS / ローカル AES）と `encryptSecret` / `decryptSecret` |
| `functions/src/google/deps.ts` | 外部呼び出しの注入口 `GoogleDeps` と本番実装 `defaultGoogleDeps` |
| `functions/src/google/oauthClient.ts` | OAuth クライアントの登録・削除・コールバック URL の取得 |
| `functions/src/google/connect.ts` | 認可 URL の発行・コールバック処理・連携の解除 |
| `functions/src/google/gbpClientFactory.ts` | 連携から `GbpClient` を組み立てる。トークン失効時に連携を `error` にする |
| `functions/src/stores/stores.ts` | 取込候補の取得・取込・アーカイブ |
| `functions/src/index.ts` | export を追加 |
| `functions/src/google/__tests__/*.itest.ts`、`functions/src/stores/__tests__/*.itest.ts`、`functions/src/shared/__tests__/secrets.test.ts` | テスト |
| `functions/src/__tests__/fakeGoogle.ts` | テスト用の偽 `GoogleDeps` |
| `app/types/domain.ts` | `Organization.googleOAuthClient`、`GbpLocation.accountName` を追加 |
| `app/utils/firebase/converters.ts` | `toOrganization` に `googleOAuthClient` |
| `app/utils/mock/functions/google.ts` | OAuth クライアント登録のモック |
| `app/composables/useGoogleConnection.ts` / `useStores.ts` / `useAdminNav.ts` | モード分岐・本接続画面の追加 |
| `app/components/Settings/Google/SetupGuide.vue` / `OAuthClientForm.vue` | 設定画面の部品 |
| `app/pages/admin/[orgId]/settings/google.vue` | 本物モードの連携 UI |
| `.claude/PROJECT.md` | 環境変数・手順の追記 |

---

### Task 1: 秘密の暗号化（`SecretCipher`）

**Files:**
- Modify: `functions/package.json`（`@google-cloud/kms` を dependencies に追加）
- Create: `functions/src/shared/secrets.ts`
- Test: `functions/src/shared/__tests__/secrets.test.ts`

**Interfaces:**
- Consumes: 計画 2 の `fail`
- Produces:
  - `type CipherKind = 'kms' | 'local'`
  - `interface EncryptedSecret { ciphertext: string; cipher: CipherKind; keyVersion: string | null }`
  - `encryptSecret(plaintext: string): Promise<EncryptedSecret>`
  - `decryptSecret(secret: EncryptedSecret): Promise<string>`

- [ ] **Step 1: 依存を追加する**

Run: `cd functions && npm install @google-cloud/kms@^5`
Expected: dependencies に `@google-cloud/kms` が入る。`node_modules/@google-cloud/kms/build/src/index.d.ts` で `KeyManagementServiceClient` の `encrypt({ name, plaintext })` / `decrypt({ name, ciphertext })` が `[response]` を返すことを確認する

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/shared/__tests__/secrets.test.ts`:

```ts
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { decryptSecret, encryptSecret, resetSecretCipherForTest } from '../secrets'

const original = { ...process.env }

beforeEach(() => {
  resetSecretCipherForTest()
  delete process.env.FUNCTIONS_EMULATOR
  delete process.env.KMS_KEY_NAME
  process.env.SECRET_CIPHER = 'local'
})

afterEach(() => {
  process.env = { ...original }
  resetSecretCipherForTest()
})

test('ローカル暗号: 暗号化して復号すると元に戻り、暗号文に平文を含まない', async () => {
  const secret = await encryptSecret('refresh-token-123')

  assert.equal(secret.cipher, 'local')
  assert.ok(!secret.ciphertext.includes('refresh-token-123'))
  assert.equal(await decryptSecret(secret), 'refresh-token-123')
})

test('ローカル暗号: 同じ平文でも毎回違う暗号文になる', async () => {
  const a = await encryptSecret('same')
  const b = await encryptSecret('same')
  assert.notEqual(a.ciphertext, b.ciphertext)
})

test('ローカル暗号: 改ざんされた暗号文は復号に失敗する', async () => {
  const secret = await encryptSecret('value')
  const bytes = Buffer.from(secret.ciphertext, 'base64')
  bytes[bytes.length - 1] ^= 0xff
  await assert.rejects(decryptSecret({ ...secret, ciphertext: bytes.toString('base64') }))
})

test('本番設定（local 指定なし・Emulator 外）で KMS_KEY_NAME が無ければ failed-precondition', async () => {
  delete process.env.SECRET_CIPHER
  await assert.rejects(encryptSecret('x'), { code: 'failed-precondition' })
})

test('本番設定ではローカル暗号の秘密を復号しない（設定ミスの検知）', async () => {
  const secret = await encryptSecret('x')
  delete process.env.SECRET_CIPHER
  process.env.KMS_KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k'
  resetSecretCipherForTest()
  await assert.rejects(decryptSecret(secret), { code: 'failed-precondition' })
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../secrets'`）

- [ ] **Step 4: 実装する**

`functions/src/shared/secrets.ts`:

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { KeyManagementServiceClient } from '@google-cloud/kms'
import { fail } from './errors'

// OAuth のクライアントシークレット・refresh token の暗号化。
// 本番は Cloud KMS（KMS_KEY_NAME）、Emulator とテストはローカル AES-256-GCM を使う。

export type CipherKind = 'kms' | 'local'

export interface EncryptedSecret {
  ciphertext: string
  cipher: CipherKind
  /** KMS で暗号化に使った鍵バージョン（ローテーションの追跡用） */
  keyVersion: string | null
}

interface SecretCipher {
  kind: CipherKind
  encrypt(plaintext: string): Promise<EncryptedSecret>
  decrypt(secret: EncryptedSecret): Promise<string>
}

/** Emulator・テスト専用の鍵。コードに固定されているため本番では使わない */
const LOCAL_KEY = createHash('sha256').update('meo-tool-local-dev-only').digest()
const IV_BYTES = 12
const TAG_BYTES = 16

const localCipher: SecretCipher = {
  kind: 'local',
  async encrypt(plaintext) {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', LOCAL_KEY, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'), cipher: 'local', keyVersion: null }
  },
  async decrypt(secret) {
    const bytes = Buffer.from(secret.ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', LOCAL_KEY, bytes.subarray(0, IV_BYTES))
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  },
}

function createKmsCipher(keyName: string): SecretCipher {
  const client = new KeyManagementServiceClient()
  return {
    kind: 'kms',
    async encrypt(plaintext) {
      const [response] = await client.encrypt({ name: keyName, plaintext: Buffer.from(plaintext, 'utf8') })
      return {
        ciphertext: Buffer.from(response.ciphertext as Uint8Array).toString('base64'),
        cipher: 'kms',
        keyVersion: response.name ?? null,
      }
    },
    async decrypt(secret) {
      const [response] = await client.decrypt({ name: keyName, ciphertext: Buffer.from(secret.ciphertext, 'base64') })
      return Buffer.from(response.plaintext as Uint8Array).toString('utf8')
    },
  }
}

let cached: SecretCipher | null = null

function isLocalAllowed(): boolean {
  return process.env.SECRET_CIPHER === 'local' || process.env.FUNCTIONS_EMULATOR === 'true'
}

function getCipher(): SecretCipher {
  if (cached) return cached
  if (isLocalAllowed()) return (cached = localCipher)
  const keyName = process.env.KMS_KEY_NAME
  if (!keyName) fail('failed-precondition', '暗号鍵（KMS_KEY_NAME）が設定されていません。運営にお問い合わせください。')
  return (cached = createKmsCipher(keyName))
}

export function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
  return Promise.resolve().then(() => getCipher().encrypt(plaintext))
}

export function decryptSecret(secret: EncryptedSecret): Promise<string> {
  return Promise.resolve().then(() => {
    const cipher = getCipher()
    if (secret.cipher !== cipher.kind) {
      fail('failed-precondition', '保存されている秘密の暗号方式が現在の設定と一致しません。運営にお問い合わせください。')
    }
    return cipher.decrypt(secret)
  })
}

/** テストで環境変数を切り替えたときに選択をやり直す */
export function resetSecretCipherForTest(): void {
  cached = null
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（計画 1・2 の 44 件 + secrets 5 件 = 49 件）

---

### Task 2: 外部呼び出しの注入口と OAuth クライアントの登録

**Files:**
- Create: `functions/src/google/deps.ts`
- Create: `functions/src/google/oauthClient.ts`
- Create: `functions/src/__tests__/fakeGoogle.ts`
- Modify: `functions/src/__tests__/emulator.ts`（`SECRET_CIPHER=local` を設定）
- Test: `functions/src/google/__tests__/oauthClient.itest.ts`

**Interfaces:**
- Consumes: Task 1 の `encryptSecret` / `decryptSecret` / `EncryptedSecret`、計画 1 の `GbpClient` / `createTokenProvider`、計画 2 の共通処理
- Produces:
  - `interface ExchangedTokens { refreshToken: string | null; accessToken: string; googleEmail: string }`
  - `interface GoogleDeps { exchangeCode(input: { clientId; clientSecret; redirectUri; code }): Promise<ExchangedTokens>; listAccounts(accessToken: string): Promise<GbpAccount[]>; revokeToken(token: string): Promise<void>; createGbpClient(input: { clientId; clientSecret; refreshToken }): GbpClient }`
  - `defaultGoogleDeps: GoogleDeps`
  - `interface OAuthClientSecretDoc { orgId: string; clientId: string; secret: EncryptedSecret }`
  - `loadOAuthClient(db, orgId): Promise<{ clientId: string; clientSecret: string }>`（未登録は `failed-precondition`）
  - `updateGoogleOAuthClientFunc(db, caller, { orgId, clientId, clientSecret }): Promise<void>`
  - `deleteGoogleOAuthClientFunc(db, caller, { orgId }): Promise<void>`
  - `getGoogleOAuthConfigFunc(db, caller, { orgId }): Promise<{ callbackUrl: string }>`
  - 組織ドキュメントのフィールド `googleOAuthClient: { clientId: string; configuredAt: Timestamp; configuredBy: string } | null`
  - テスト helper: `createFakeGoogle(overrides?): { deps: GoogleDeps; calls: { exchange: number; revoked: string[] } }`

- [ ] **Step 1: テスト helper を準備する**

`functions/src/__tests__/emulator.ts` の `TEST_PROJECT_ID` の下に追加する（テストは常にローカル暗号を使う）。

```ts
process.env.SECRET_CIPHER = 'local'
```

`functions/src/__tests__/fakeGoogle.ts`:

```ts
import { GbpAuthError, GbpClient } from '../shared/gbp'
import type { GbpAccount, GbpLocation } from '../shared/gbp'
import type { ExchangedTokens, GoogleDeps } from '../google/deps'

interface FakeGoogleOptions {
  tokens?: ExchangedTokens
  accounts?: GbpAccount[]
  /** refresh token ごとのロケーション。キーが無い refresh token は GbpAuthError にする */
  locationsByRefreshToken?: Record<string, Record<string, GbpLocation[]>>
  exchangeError?: Error
}

/** 外部（Google）を呼ばない偽の GoogleDeps。GbpClient は偽 fetch で応答を返す */
export function createFakeGoogle(options: FakeGoogleOptions = {}) {
  const calls = { exchange: 0, revoked: [] as string[], exchangeInputs: [] as unknown[] }
  const deps: GoogleDeps = {
    async exchangeCode(input) {
      calls.exchange++
      calls.exchangeInputs.push(input)
      if (options.exchangeError) throw options.exchangeError
      return options.tokens ?? { refreshToken: 'refresh-1', accessToken: 'access-1', googleEmail: 'Shop@Example.com' }
    },
    async listAccounts() {
      return options.accounts ?? [{ name: 'accounts/100', accountName: 'ハナミ食堂' }]
    },
    async revokeToken(token) {
      calls.revoked.push(token)
    },
    createGbpClient({ refreshToken }) {
      const byAccount = options.locationsByRefreshToken?.[refreshToken]
      return new GbpClient({
        getAccessToken: async () => {
          if (!byAccount) throw new GbpAuthError('invalid_grant', 'Google の認証が無効です（invalid_grant）。再認証してください')
          return 'access'
        },
        fetch: (async (input: string | URL | Request) => {
          const url = String(input)
          const account = url.match(/v1\/(accounts\/[^/]+)\/locations/)?.[1] ?? ''
          return new Response(JSON.stringify({ locations: byAccount?.[account] ?? [] }), { status: 200 })
        }) as typeof fetch,
        sleep: async () => {},
      })
    },
  }
  return { deps, calls }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/google/__tests__/oauthClient.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { deleteGoogleOAuthClientFunc, getGoogleOAuthConfigFunc, loadOAuthClient, updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com'

beforeEach(async () => {
  await clearFirestore()
  process.env.OAUTH_CALLBACK_URL = 'https://example.test/googleOAuthCallback'
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-admin', role: 'admin' }],
  })
})

test('updateGoogleOAuthClient: owner が登録すると、シークレットは暗号化して全拒否コレクションに保存する', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: ` ${CLIENT_ID} `, clientSecret: 'GOCSPX-secret' })

  const org = (await db.doc('organizations/org-a').get()).data()!
  assert.equal(org.googleOAuthClient.clientId, CLIENT_ID)
  assert.equal(org.googleOAuthClient.configuredBy, 'u-owner')
  const saved = (await db.doc('oauthClientSecrets/org-a').get()).data()!
  assert.ok(!JSON.stringify(saved).includes('GOCSPX-secret'))
  assert.deepEqual(await loadOAuthClient(db, 'org-a'), { clientId: CLIENT_ID, clientSecret: 'GOCSPX-secret' })
})

test('updateGoogleOAuthClient: admin は不可、クライアント ID の形式違いは invalid-argument', async () => {
  await assert.rejects(
    updateGoogleOAuthClientFunc(db, caller('u-admin'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 's' }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: 'not-a-client-id', clientSecret: 's' }),
    { code: 'invalid-argument', message: 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。' },
  )
})

test('loadOAuthClient: 未登録なら failed-precondition', async () => {
  await assert.rejects(loadOAuthClient(db, 'org-a'), {
    code: 'failed-precondition',
    message: 'Google OAuth クライアントが登録されていません。Google 連携の設定画面で登録してください。',
  })
})

test('deleteGoogleOAuthClient: 有効な連携が残っていれば拒否し、無ければ削除する', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ status: 'active', googleEmail: 'a@example.com' })

  await assert.rejects(
    deleteGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a' }),
    { code: 'failed-precondition', message: '連携中の Google アカウントがあります。先に連携を解除してください。' },
  )

  await db.doc('organizations/org-a/googleConnections/c-1').update({ status: 'revoked' })
  await deleteGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a' })

  assert.equal((await db.doc('organizations/org-a').get()).get('googleOAuthClient'), null)
  assert.equal((await db.doc('oauthClientSecrets/org-a').get()).exists, false)
})

test('getGoogleOAuthConfig: owner / admin にコールバック URL を返す。未設定なら failed-precondition', async () => {
  assert.deepEqual(await getGoogleOAuthConfigFunc(db, caller('u-admin'), { orgId: 'org-a' }), { callbackUrl: 'https://example.test/googleOAuthCallback' })
  delete process.env.OAUTH_CALLBACK_URL
  await assert.rejects(getGoogleOAuthConfigFunc(db, caller('u-owner'), { orgId: 'org-a' }), { code: 'failed-precondition' })
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../oauthClient'` / `'../google/deps'`）

- [ ] **Step 4: 注入口を実装する**

`functions/src/google/deps.ts`:

```ts
import { OAuth2Client } from 'google-auth-library'
import { createTokenProvider, GbpClient, type GbpAccount } from '../shared/gbp'

// Google（OAuth・GBP API）への外部呼び出し。テストでは偽物に差し替える。

export interface ExchangedTokens {
  /** 以前に同意済みなどで返らないことがある */
  refreshToken: string | null
  accessToken: string
  googleEmail: string
}

export interface GoogleDeps {
  exchangeCode(input: { clientId: string; clientSecret: string; redirectUri: string; code: string }): Promise<ExchangedTokens>
  listAccounts(accessToken: string): Promise<GbpAccount[]>
  revokeToken(token: string): Promise<void>
  createGbpClient(input: { clientId: string; clientSecret: string; refreshToken: string }): GbpClient
}

export const defaultGoogleDeps: GoogleDeps = {
  async exchangeCode({ clientId, clientSecret, redirectUri, code }) {
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
    const { tokens } = await client.getToken(code)
    if (!tokens.access_token) throw new Error('access token が返りませんでした')
    const info = await client.getTokenInfo(tokens.access_token)
    return { refreshToken: tokens.refresh_token ?? null, accessToken: tokens.access_token, googleEmail: info.email ?? '' }
  },
  listAccounts(accessToken) {
    return new GbpClient({ getAccessToken: async () => accessToken }).listAccounts()
  },
  async revokeToken(token) {
    await new OAuth2Client().revokeToken(token)
  },
  createGbpClient({ clientId, clientSecret, refreshToken }) {
    return new GbpClient({ getAccessToken: createTokenProvider({ clientId, clientSecret, refreshToken }) })
  },
}
```

- [ ] **Step 5: OAuth クライアントの登録を実装する**

`functions/src/google/oauthClient.ts`:

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { orgRef, requireMember, requireOrg } from '../shared/members'
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../shared/secrets'
import { asObject, requireId, requireString } from '../shared/validation'

// 組織ごとの Google OAuth クライアント（各組織が自社の GCP で作成したもの）

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

export interface OAuthClientSecretDoc {
  orgId: string
  clientId: string
  secret: EncryptedSecret
}

function secretRef(db: Firestore, orgId: string) {
  return db.doc(`oauthClientSecrets/${orgId}`)
}

/** 復号したクライアント ID とシークレット。Functions 内でだけ使い、外に返さない */
export async function loadOAuthClient(db: Firestore, orgId: string): Promise<{ clientId: string; clientSecret: string }> {
  const snapshot = await secretRef(db, orgId).get()
  if (!snapshot.exists) {
    fail('failed-precondition', 'Google OAuth クライアントが登録されていません。Google 連携の設定画面で登録してください。')
  }
  const doc = snapshot.data() as OAuthClientSecretDoc
  return { clientId: doc.clientId, clientSecret: await decryptSecret(doc.secret) }
}

export async function updateGoogleOAuthClientFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const clientId = requireString(input.clientId, 'クライアント ID', 200)
  const clientSecret = requireString(input.clientSecret, 'クライアントシークレット', 200)
  if (!clientId.endsWith(CLIENT_ID_SUFFIX)) {
    fail('invalid-argument', 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。')
  }

  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner'])
  const secret = await encryptSecret(clientSecret)
  await db.runTransaction(async (tx) => {
    tx.set(secretRef(db, orgId), { orgId, clientId, secret, updatedAt: FieldValue.serverTimestamp() } satisfies OAuthClientSecretDoc & { updatedAt: unknown })
    tx.update(orgRef(db, orgId), {
      googleOAuthClient: { clientId, configuredAt: FieldValue.serverTimestamp(), configuredBy: caller.uid },
    })
    writeAuditLog(tx, db, orgId, 'googleOAuthClient.update', caller.uid, { clientId })
  })
}

export async function deleteGoogleOAuthClientFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner'], tx)
    const remaining = await tx.get(db.collection(`organizations/${orgId}/googleConnections`).where('status', 'in', ['active', 'error']))
    if (!remaining.empty) fail('failed-precondition', '連携中の Google アカウントがあります。先に連携を解除してください。')
    tx.delete(secretRef(db, orgId))
    tx.update(orgRef(db, orgId), { googleOAuthClient: null })
    writeAuditLog(tx, db, orgId, 'googleOAuthClient.delete', caller.uid)
  })
}

/** 各組織が自社の OAuth クライアントに登録するリダイレクト URI（全組織共通） */
export function requireCallbackUrl(): string {
  const url = process.env.OAUTH_CALLBACK_URL
  if (!url) fail('failed-precondition', 'コールバック URL（OAUTH_CALLBACK_URL）が設定されていません。運営にお問い合わせください。')
  return url
}

export async function getGoogleOAuthConfigFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ callbackUrl: string }> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  return { callbackUrl: requireCallbackUrl() }
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（計画 2 の 33 件 + oauthClient 5 件 = 38 件）

---

### Task 3: Google 連携（認可 URL・コールバック・解除）

**Files:**
- Create: `functions/src/google/connect.ts`
- Test: `functions/src/google/__tests__/connect.itest.ts`

**Interfaces:**
- Consumes: Task 2 の `GoogleDeps` / `loadOAuthClient` / `requireCallbackUrl`、Task 1 の `encryptSecret` / `decryptSecret`、`createFakeGoogle`
- Produces:
  - `GBP_SCOPES: string[]`
  - `createGoogleAuthUrlFunc(db, caller, { orgId }): Promise<{ url: string }>`
  - `handleGoogleOAuthCallback(db, query: { code?: string; state?: string; error?: string }, deps?: GoogleDeps): Promise<string>`（リダイレクト先 URL を返す）
  - `deleteGoogleConnectionFunc(db, caller, { orgId, connectionId }, deps?: GoogleDeps): Promise<void>`
  - Firestore: `googleConnections/{id}` = `{ orgId, googleEmail, gbpAccounts: { name, accountName, type }[], scopes, status, lastError, connectedBy, connectedAt }`、`oauthTokens/{connectionId}` = `{ orgId, secret: EncryptedSecret }`
  - リダイレクト先: 成功 `{ADMIN_APP_URL}/admin/{orgId}/settings/google?connected=1`、失敗 `...?error={code}`（`access_denied` / `invalid_client` / `exchange_failed` / `no_refresh_token` / `gbp_accounts_failed`）、state 不正 `{ADMIN_APP_URL}/orgs?googleError=invalid_state`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/google/__tests__/connect.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { decryptSecret } from '../../shared/secrets'
import { createGoogleAuthUrlFunc, deleteGoogleConnectionFunc, handleGoogleOAuthCallback } from '../connect'
import { updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com'
const APP = 'https://app.example.test'

beforeEach(async () => {
  await clearFirestore()
  process.env.OAUTH_CALLBACK_URL = 'https://fn.example.test/googleOAuthCallback'
  process.env.ADMIN_APP_URL = APP
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 'secret-a' })
})

async function startAuth(): Promise<string> {
  const { url } = await createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-a' })
  return new URL(url).searchParams.get('state')!
}

test('createGoogleAuthUrl: 組織のクライアント ID・オフライン・同意画面・スコープを付け、state を保存する', async () => {
  const { url } = await createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-a' })
  const parsed = new URL(url)

  assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(parsed.searchParams.get('client_id'), CLIENT_ID)
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://fn.example.test/googleOAuthCallback')
  assert.equal(parsed.searchParams.get('access_type'), 'offline')
  assert.equal(parsed.searchParams.get('prompt'), 'consent')
  assert.match(parsed.searchParams.get('scope')!, /business\.manage/)
  const state = (await db.doc(`oauthStates/${parsed.searchParams.get('state')}`).get()).data()!
  assert.equal(state.orgId, 'org-a')
  assert.equal(state.uid, 'u-owner')
})

test('createGoogleAuthUrl: staff は不可、OAuth クライアント未登録は failed-precondition', async () => {
  await assert.rejects(createGoogleAuthUrlFunc(db, caller('u-staff'), { orgId: 'org-a' }), { code: 'permission-denied' })
  await seedOrg(db, { orgId: 'org-b', members: [{ uid: 'u-owner', role: 'owner' }] })
  await assert.rejects(createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-b' }), { code: 'failed-precondition' })
})

test('callback: コードを交換し、refresh token を暗号化保存して連携を作り、設定画面へ戻す', async () => {
  const state = await startAuth()
  const fake = createFakeGoogle()

  const redirect = await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  assert.equal(redirect, `${APP}/admin/org-a/settings/google?connected=1`)
  const connections = await db.collection('organizations/org-a/googleConnections').get()
  assert.equal(connections.size, 1)
  const connection = connections.docs[0].data()
  assert.equal(connection.googleEmail, 'shop@example.com')
  assert.equal(connection.status, 'active')
  assert.deepEqual(connection.gbpAccounts, [{ name: 'accounts/100', accountName: 'ハナミ食堂', type: null }])
  const token = (await db.doc(`oauthTokens/${connections.docs[0].id}`).get()).data()!
  assert.equal(await decryptSecret(token.secret), 'refresh-1')
  assert.equal((await db.doc(`oauthStates/${state}`).get()).exists, false)
  assert.equal((fake.calls.exchangeInputs[0] as { clientSecret: string }).clientSecret, 'secret-a')
})

test('callback: 同じ state は 2 回使えない（連携は 1 つだけ）', async () => {
  const state = await startAuth()
  const fake = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  const second = await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  assert.equal(second, `${APP}/orgs?googleError=invalid_state`)
  assert.equal((await db.collection('organizations/org-a/googleConnections').get()).size, 1)
  assert.equal(fake.calls.exchange, 1)
})

test('callback: 期限切れ・存在しない state は invalid_state', async () => {
  const state = await startAuth()
  await db.doc(`oauthStates/${state}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
  const fake = createFakeGoogle()

  assert.equal(await handleGoogleOAuthCallback(db, { code: 'c', state }, fake.deps), `${APP}/orgs?googleError=invalid_state`)
  assert.equal(await handleGoogleOAuthCallback(db, { code: 'c', state: 'unknown' }, fake.deps), `${APP}/orgs?googleError=invalid_state`)
  assert.equal(fake.calls.exchange, 0)
})

test('callback: 同意拒否・refresh token なし・交換失敗はエラーコード付きで戻し、連携を作らない', async () => {
  const base = `${APP}/admin/org-a/settings/google?error=`
  assert.equal(await handleGoogleOAuthCallback(db, { error: 'access_denied', state: await startAuth() }, createFakeGoogle().deps), `${base}access_denied`)
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ tokens: { refreshToken: null, accessToken: 'a', googleEmail: 'x@example.com' } }).deps),
    `${base}no_refresh_token`,
  )
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ exchangeError: Object.assign(new Error('invalid_client'), { response: { data: { error: 'invalid_client' } } }) }).deps),
    `${base}invalid_client`,
  )
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ exchangeError: new Error('boom') }).deps),
    `${base}exchange_failed`,
  )
  assert.equal((await db.collection('organizations/org-a/googleConnections').get()).size, 0)
})

test('callback: 同じ Google アカウントで連携し直すと既存の連携を更新する（再認証）', async () => {
  const first = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'c1', state: await startAuth() }, first.deps)
  const [existing] = (await db.collection('organizations/org-a/googleConnections').get()).docs
  await existing.ref.update({ status: 'error', lastError: '再認証が必要です' })

  const second = createFakeGoogle({ tokens: { refreshToken: 'refresh-2', accessToken: 'a2', googleEmail: 'shop@example.com' } })
  await handleGoogleOAuthCallback(db, { code: 'c2', state: await startAuth() }, second.deps)

  const connections = await db.collection('organizations/org-a/googleConnections').get()
  assert.equal(connections.size, 1)
  assert.equal(connections.docs[0].get('status'), 'active')
  assert.equal(connections.docs[0].get('lastError'), null)
  assert.equal(await decryptSecret((await db.doc(`oauthTokens/${existing.id}`).get()).get('secret')), 'refresh-2')
})

test('deleteGoogleConnection: Google 側を取り消し、トークンを削除して revoked にする', async () => {
  const fake = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'c1', state: await startAuth() }, fake.deps)
  const [connection] = (await db.collection('organizations/org-a/googleConnections').get()).docs

  await deleteGoogleConnectionFunc(db, caller('u-owner'), { orgId: 'org-a', connectionId: connection.id }, fake.deps)

  assert.deepEqual(fake.calls.revoked, ['refresh-1'])
  assert.equal((await db.doc(`oauthTokens/${connection.id}`).get()).exists, false)
  assert.equal((await connection.ref.get()).get('status'), 'revoked')
  await assert.rejects(
    deleteGoogleConnectionFunc(db, caller('u-staff'), { orgId: 'org-a', connectionId: connection.id }, fake.deps),
    { code: 'permission-denied' },
  )
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../connect'`）

- [ ] **Step 3: 実装する**

`functions/src/google/connect.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg } from '../shared/members'
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../shared/secrets'
import { asObject, requireId } from '../shared/validation'
import { defaultGoogleDeps, type GoogleDeps } from './deps'
import { loadOAuthClient, requireCallbackUrl } from './oauthClient'

// F-04 Google 連携。組織ごとの OAuth クライアントで認可し、refresh token を暗号化して保存する。

export const GBP_SCOPES = ['https://www.googleapis.com/auth/business.manage', 'openid', 'email']
const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthStateDoc {
  orgId: string
  uid: string
  expiresAt: Timestamp
}

type CallbackErrorCode = 'access_denied' | 'invalid_client' | 'exchange_failed' | 'no_refresh_token' | 'gbp_accounts_failed'

function appUrl(path: string): string {
  return `${(process.env.ADMIN_APP_URL ?? '').replace(/\/$/, '')}${path}`
}

function settingsUrl(orgId: string, query: string): string {
  return appUrl(`/admin/${orgId}/settings/google?${query}`)
}

export async function createGoogleAuthUrlFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ url: string }> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const { clientId } = await loadOAuthClient(db, orgId)
  const redirectUri = requireCallbackUrl()

  const state = randomBytes(24).toString('base64url')
  await db.doc(`oauthStates/${state}`).set({
    orgId,
    uid: caller.uid,
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
    createdAt: FieldValue.serverTimestamp(),
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return { url: url.toString() }
}

/** state を 1 回だけ使えるように、読むと同時に削除する。不正・期限切れなら null */
async function consumeState(db: Firestore, state: string | undefined): Promise<OAuthStateDoc | null> {
  if (!state || !/^[A-Za-z0-9_-]+$/.test(state)) return null
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`oauthStates/${state}`)
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return null
    tx.delete(ref)
    const doc = snapshot.data() as OAuthStateDoc
    return doc.expiresAt.toMillis() > Date.now() ? doc : null
  })
}

function toCallbackErrorCode(error: unknown): CallbackErrorCode {
  const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error
  return code === 'invalid_client' || code === 'unauthorized_client' ? 'invalid_client' : 'exchange_failed'
}

/**
 * OAuth のコールバック（onRequest）の本体。リダイレクト先の URL を返す。
 * 同じ組織で同じ Google アカウントの連携があれば、それを更新する（再認証）。
 */
export async function handleGoogleOAuthCallback(
  db: Firestore,
  query: { code?: string; state?: string; error?: string },
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<string> {
  const state = await consumeState(db, query.state)
  if (!state) return appUrl('/orgs?googleError=invalid_state')
  const errorUrl = (code: CallbackErrorCode) => settingsUrl(state.orgId, `error=${code}`)
  if (query.error || !query.code) return errorUrl('access_denied')

  let tokens
  try {
    const client = await loadOAuthClient(db, state.orgId)
    tokens = await deps.exchangeCode({ ...client, redirectUri: requireCallbackUrl(), code: query.code })
  }
  catch (error) {
    logger.warn('OAuth のコード交換に失敗しました', { orgId: state.orgId, error: String(error) })
    return errorUrl(toCallbackErrorCode(error))
  }
  if (!tokens.refreshToken) return errorUrl('no_refresh_token')

  let accounts
  try {
    accounts = await deps.listAccounts(tokens.accessToken)
  }
  catch (error) {
    logger.warn('GBP アカウントの取得に失敗しました', { orgId: state.orgId, error: String(error) })
    return errorUrl('gbp_accounts_failed')
  }

  const googleEmail = tokens.googleEmail.toLowerCase()
  const secret = await encryptSecret(tokens.refreshToken)
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection(`organizations/${state.orgId}/googleConnections`).where('googleEmail', '==', googleEmail).limit(1))
    const ref = existing.empty ? db.collection(`organizations/${state.orgId}/googleConnections`).doc() : existing.docs[0].ref
    const now = FieldValue.serverTimestamp()
    tx.set(ref, {
      orgId: state.orgId,
      googleEmail,
      gbpAccounts: accounts.map(account => ({ name: account.name, accountName: account.accountName ?? account.name, type: account.type ?? null })),
      scopes: GBP_SCOPES,
      status: 'active',
      lastError: null,
      connectedBy: state.uid,
      connectedAt: now,
    })
    tx.set(db.doc(`oauthTokens/${ref.id}`), { orgId: state.orgId, secret, updatedAt: now })
    writeAuditLog(tx, db, state.orgId, existing.empty ? 'googleConnection.create' : 'googleConnection.reauthorize', state.uid, { connectionId: ref.id, googleEmail })
  })
  return settingsUrl(state.orgId, 'connected=1')
}

/** 解除しても取込済みの店舗は残す（口コミ URL は placeId だけで動くため） */
export async function deleteGoogleConnectionFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const connectionId = requireId(input.connectionId, '連携 ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const connectionRef = db.doc(`organizations/${orgId}/googleConnections/${connectionId}`)
  if (!(await connectionRef.get()).exists) fail('not-found', '連携が見つかりません。')

  const tokenRef = db.doc(`oauthTokens/${connectionId}`)
  const token = await tokenRef.get()
  if (token.exists) {
    try {
      await deps.revokeToken(await decryptSecret(token.get('secret') as EncryptedSecret))
    }
    catch (error) {
      // 既に Google 側で取り消されている場合など。こちらの削除は続ける
      logger.warn('Google 側のトークン取り消しに失敗しました', { orgId, connectionId, error: String(error) })
    }
  }
  await db.runTransaction(async (tx) => {
    tx.delete(tokenRef)
    tx.update(connectionRef, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid })
    writeAuditLog(tx, db, orgId, 'googleConnection.delete', caller.uid, { connectionId })
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（38 件 + connect 8 件 = 46 件）

---

### Task 4: 連携から `GbpClient` を組み立てる共通処理

**Files:**
- Create: `functions/src/google/gbpClientFactory.ts`
- Test: `functions/src/google/__tests__/gbpClientFactory.itest.ts`

**Interfaces:**
- Consumes: Task 2 の `GoogleDeps` / `loadOAuthClient`、Task 1 の `decryptSecret`、計画 1 の `GbpAuthError` / `GbpApiError`
- Produces:
  - `createGbpClientForConnection(db, orgId, connectionId, deps?: GoogleDeps): Promise<GbpClient>`（連携が `active` 以外なら `failed-precondition`）
  - `markConnectionError(db, orgId, connectionId, message): Promise<void>`
  - `toGbpHttpsError(error: unknown): unknown`（`GbpAuthError` → `failed-precondition`「Google 連携の再認証が必要です。…」、`GbpApiError` 429 → `resource-exhausted`、その他の `GbpApiError` → `unavailable`、それ以外はそのまま）
  - `withConnectionErrors<T>(db, orgId, connectionId, run: () => Promise<T>): Promise<T>`（`GbpAuthError` を捕まえたら連携を `error` にしてから `toGbpHttpsError` で投げ直す）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/google/__tests__/gbpClientFactory.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { GbpApiError, GbpAuthError } from '../../shared/gbp'
import { encryptSecret } from '../../shared/secrets'
import { createGbpClientForConnection, toGbpHttpsError, withConnectionErrors } from '../gbpClientFactory'
import { updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ orgId: 'org-a', status: 'active', googleEmail: 'a@example.com', lastError: null })
  await db.doc('oauthTokens/c-1').set({ orgId: 'org-a', secret: await encryptSecret('refresh-ok') })
})

test('createGbpClientForConnection: 復号した refresh token でクライアントを作る', async () => {
  const fake = createFakeGoogle({ locationsByRefreshToken: { 'refresh-ok': { 'accounts/1': [{ name: 'locations/9', title: '本店' }] } } })
  const client = await createGbpClientForConnection(db, 'org-a', 'c-1', fake.deps)
  const locations = await client.listLocations('accounts/1', 'name,title')
  assert.equal(locations[0].title, '本店')
})

test('createGbpClientForConnection: 連携が active でなければ failed-precondition', async () => {
  await db.doc('organizations/org-a/googleConnections/c-1').update({ status: 'error' })
  await assert.rejects(createGbpClientForConnection(db, 'org-a', 'c-1', createFakeGoogle().deps), { code: 'failed-precondition' })
})

test('withConnectionErrors: GbpAuthError なら連携を error にして failed-precondition で投げ直す', async () => {
  await assert.rejects(
    withConnectionErrors(db, 'org-a', 'c-1', async () => { throw new GbpAuthError('invalid_grant', 'x') }),
    { code: 'failed-precondition', message: 'Google 連携の再認証が必要です。Google 連携の設定画面で再認証してください。' },
  )
  const connection = (await db.doc('organizations/org-a/googleConnections/c-1').get()).data()!
  assert.equal(connection.status, 'error')
  assert.equal(connection.lastError, 'Google の認証が切れました（invalid_grant）。再認証してください。')
})

test('toGbpHttpsError: 429 は resource-exhausted、その他の API エラーは unavailable、それ以外はそのまま', () => {
  assert.equal((toGbpHttpsError(new GbpApiError(429, 'RESOURCE_EXHAUSTED', 'q')) as { code: string }).code, 'resource-exhausted')
  const unavailable = toGbpHttpsError(new GbpApiError(400, 'INVALID_ARGUMENT', 'Invalid phone')) as { code: string; message: string }
  assert.equal(unavailable.code, 'unavailable')
  assert.match(unavailable.message, /Invalid phone/)
  const other = new Error('x')
  assert.equal(toGbpHttpsError(other), other)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../gbpClientFactory'`）

- [ ] **Step 3: 実装する**

`functions/src/google/gbpClientFactory.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/https'
import { fail } from '../shared/errors'
import { GbpApiError, GbpAuthError, type GbpClient } from '../shared/gbp'
import { decryptSecret, type EncryptedSecret } from '../shared/secrets'
import { defaultGoogleDeps, type GoogleDeps } from './deps'
import { loadOAuthClient } from './oauthClient'

// 連携（googleConnections + oauthTokens）から GbpClient を組み立てる。計画 4 のプロフィール・口コミ・投稿で使う。

const REAUTH_MESSAGE = 'Google 連携の再認証が必要です。Google 連携の設定画面で再認証してください。'

export async function createGbpClientForConnection(
  db: Firestore,
  orgId: string,
  connectionId: string,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<GbpClient> {
  const connection = await db.doc(`organizations/${orgId}/googleConnections/${connectionId}`).get()
  if (!connection.exists) fail('not-found', 'Google 連携が見つかりません。')
  if (connection.get('status') !== 'active') fail('failed-precondition', REAUTH_MESSAGE)
  const token = await db.doc(`oauthTokens/${connectionId}`).get()
  if (!token.exists) fail('failed-precondition', REAUTH_MESSAGE)

  const client = await loadOAuthClient(db, orgId)
  const refreshToken = await decryptSecret(token.get('secret') as EncryptedSecret)
  return deps.createGbpClient({ ...client, refreshToken })
}

export async function markConnectionError(db: Firestore, orgId: string, connectionId: string, message: string): Promise<void> {
  await db.doc(`organizations/${orgId}/googleConnections/${connectionId}`).update({ status: 'error', lastError: message })
}

/** GBP のエラーを画面に出せる HttpsError にする */
export function toGbpHttpsError(error: unknown): unknown {
  if (error instanceof GbpAuthError) return new HttpsError('failed-precondition', REAUTH_MESSAGE)
  if (error instanceof GbpApiError) {
    if (error.status === 429) return new HttpsError('resource-exhausted', 'Google 側の利用上限に達しました。時間をおいて再実行してください。')
    return new HttpsError('unavailable', `Google ビジネスプロフィールでエラーが発生しました: ${error.message}`)
  }
  return error
}

/** GBP を呼ぶ処理を包む。トークン失効なら連携を error にして、再認証を促すエラーにする */
export async function withConnectionErrors<T>(db: Firestore, orgId: string, connectionId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    if (error instanceof GbpAuthError) {
      await markConnectionError(db, orgId, connectionId, `Google の認証が切れました（${error.reason}）。再認証してください。`)
    }
    throw toGbpHttpsError(error)
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（46 件 + factory 4 件 = 50 件）

---

### Task 5: 店舗の取込候補・取込・アーカイブと公開

**Files:**
- Create: `functions/src/stores/stores.ts`
- Test: `functions/src/stores/__tests__/stores.itest.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 2〜4 のすべて
- Produces:
  - `LOCATION_READ_MASK = 'name,title,storefrontAddress,latlng,metadata.placeId'`
  - `interface LocationCandidate { connectionId; accountName; locationName; title; address; placeId: string | null; lat; lng; isImported; isImportable }`（クライアントの `GbpLocationCandidate` + `accountName`）
  - `getGbpLocationsFunc(db, caller, { orgId }, deps?): Promise<LocationCandidate[]>`
  - `createStoresFromGbpFunc(db, caller, { orgId, locationNames }, deps?): Promise<{ storeIds: string[] }>`
  - `updateStoreArchiveFunc(db, caller, { orgId, storeId }): Promise<void>`
  - `storeIdFromLocation(locationName: string): string`（`locations/123` → `st-123`）
  - callable: `updateGoogleOAuthClient` / `deleteGoogleOAuthClient` / `getGoogleOAuthConfig` / `createGoogleAuthUrl` / `deleteGoogleConnection` / `getGbpLocations` / `createStoresFromGbp` / `updateStoreArchive`、onRequest: `googleOAuthCallback`
  - Firestore `stores/{st-xxx}` = `{ orgId, name, address, location: GeoPoint, connectionId, gbpAccountName, gbpLocationName, placeId, reviewUrl, status, createdAt }`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/stores/__tests__/stores.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { createStoresFromGbpFunc, getGbpLocationsFunc, storeIdFromLocation, updateStoreArchiveFunc } from '../stores'

const db = getTestDb()
const OWNER = caller('u-owner')

const shibuya = {
  name: 'locations/111',
  title: '渋谷店',
  storefrontAddress: { administrativeArea: '東京都', locality: '渋谷区', addressLines: ['道玄坂1-1'] },
  latlng: { latitude: 35.65, longitude: 139.7 },
  metadata: { placeId: 'place-111' },
}
const unverified = { name: 'locations/222', title: '未確認店', metadata: {} }
const shinjuku = { ...shibuya, name: 'locations/333', title: '新宿店', metadata: { placeId: 'place-333' } }

async function addConnection(id: string, refreshToken: string, accounts = [{ name: 'accounts/1', accountName: 'A', type: null }]) {
  await db.doc(`organizations/org-a/googleConnections/${id}`).set({ orgId: 'org-a', status: 'active', googleEmail: `${id}@example.com`, gbpAccounts: accounts, lastError: null })
  await db.doc(`oauthTokens/${id}`).set({ orgId: 'org-a', secret: await encryptSecret(refreshToken) })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-111'] }],
  })
  await db.doc('organizations/org-a').update({ 'limits.maxStores': 2 })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
})

test('storeIdFromLocation: locations/123 → st-123', () => {
  assert.equal(storeIdFromLocation('locations/123'), 'st-123')
})

test('getGbpLocations: 有効な連携の全アカウントのロケーションを、取込済み・取込可否付きで返す', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, unverified] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(candidates.map(c => [c.locationName, c.title, c.isImportable, c.isImported]), [
    ['locations/111', '渋谷店', true, false],
    ['locations/222', '未確認店', false, false],
  ])
  assert.equal(candidates[0].address, '東京都渋谷区道玄坂1-1')
  assert.equal(candidates[0].accountName, 'accounts/1')
  assert.equal(candidates[0].connectionId, 'c-1')
})

test('getGbpLocations: トークンが失効した連携は error にして飛ばし、他の連携の候補は返す', async () => {
  await addConnection('c-ok', 'r-ok')
  await addConnection('c-bad', 'r-bad')
  const fake = createFakeGoogle({ locationsByRefreshToken: { 'r-ok': { 'accounts/1': [shibuya] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(candidates.map(c => c.locationName), ['locations/111'])
  assert.equal((await db.doc('organizations/org-a/googleConnections/c-bad').get()).get('status'), 'error')
})

test('getGbpLocations: staff は不可', async () => {
  await assert.rejects(getGbpLocationsFunc(db, caller('u-staff'), { orgId: 'org-a' }, createFakeGoogle().deps), { code: 'permission-denied' })
})

test('createStoresFromGbp: 選んだロケーションを店舗にする（ID・口コミ URL・位置・アカウント名）', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya] } } })

  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111'] }, fake.deps)

  assert.deepEqual(storeIds, ['st-111'])
  const store = (await db.doc('organizations/org-a/stores/st-111').get()).data()!
  assert.equal(store.name, '渋谷店')
  assert.equal(store.placeId, 'place-111')
  assert.equal(store.reviewUrl, 'https://search.google.com/local/writereview?placeid=place-111')
  assert.equal(store.gbpAccountName, 'accounts/1')
  assert.equal(store.gbpLocationName, 'locations/111')
  assert.equal(store.connectionId, 'c-1')
  assert.equal(store.location.latitude, 35.65)
  assert.equal(store.status, 'active')
})

test('createStoresFromGbp: 取込済み・取込不可・候補に無いものは無視し、2 回目で重複しない', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, unverified] } } })
  await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111'] }, fake.deps)

  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/222', 'locations/999'] }, fake.deps)

  assert.deepEqual(storeIds, [])
  assert.equal((await db.collection('organizations/org-a/stores').get()).size, 1)
})

test('createStoresFromGbp: 上限を超える取込は全体を拒否する（ちょうどなら可）', async () => {
  await addConnection('c-1', 'r1')
  const third = { ...shibuya, name: 'locations/444', metadata: { placeId: 'place-444' } }
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, shinjuku, third] } } })

  await assert.rejects(
    createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/333', 'locations/444'] }, fake.deps),
    { code: 'resource-exhausted', message: '店舗数の上限（2 店舗）を超えます。' },
  )
  assert.equal((await db.collection('organizations/org-a/stores').get()).size, 0)
  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/333'] }, fake.deps)
  assert.equal(storeIds.length, 2)
})

test('updateStoreArchive: owner / admin が店舗をアーカイブする。staff は不可', async () => {
  await db.doc('organizations/org-a/stores/st-111').set({ orgId: 'org-a', name: '渋谷店', status: 'active' })
  await assert.rejects(updateStoreArchiveFunc(db, caller('u-staff'), { orgId: 'org-a', storeId: 'st-111' }), { code: 'permission-denied' })

  await updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-111' })

  assert.equal((await db.doc('organizations/org-a/stores/st-111').get()).get('status'), 'archived')
  await assert.rejects(updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-none' }), { code: 'not-found' })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../stores'`）

- [ ] **Step 3: 実装する**

`functions/src/stores/stores.ts`:

```ts
import { FieldValue, GeoPoint, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { createGbpClientForConnection, withConnectionErrors } from '../google/gbpClientFactory'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { GbpAuthError, type GbpLocation, type GbpPostalAddress } from '../shared/gbp'
import { requireMember, requireOrg } from '../shared/members'
import { asObject, requireId, requireStringArray } from '../shared/validation'

// F-05 店舗の取込・管理

export const LOCATION_READ_MASK = 'name,title,storefrontAddress,latlng,metadata.placeId'

export interface LocationCandidate {
  connectionId: string
  accountName: string
  locationName: string
  title: string
  address: string
  placeId: string | null
  lat: number
  lng: number
  isImported: boolean
  isImportable: boolean
}

export function storeIdFromLocation(locationName: string): string {
  return `st-${locationName.replace(/^locations\//, '')}`
}

function formatAddress(address: GbpPostalAddress | undefined): string {
  if (!address) return ''
  return [address.administrativeArea, address.locality, ...(address.addressLines ?? [])].filter(Boolean).join('')
}

function buildReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

function toCandidate(connectionId: string, accountName: string, location: GbpLocation): Omit<LocationCandidate, 'isImported'> {
  const placeId = location.metadata?.placeId ?? null
  return {
    connectionId,
    accountName,
    locationName: location.name,
    title: location.title ?? '',
    address: formatAddress(location.storefrontAddress),
    placeId,
    lat: location.latlng?.latitude ?? 0,
    lng: location.latlng?.longitude ?? 0,
    isImportable: placeId !== null,
  }
}

/** 有効な連携ごとにロケーションを集める。トークン失効の連携は error にして飛ばす */
async function collectCandidates(db: Firestore, orgId: string, deps: GoogleDeps): Promise<LocationCandidate[]> {
  const [connections, stores] = await Promise.all([
    db.collection(`organizations/${orgId}/googleConnections`).where('status', '==', 'active').get(),
    db.collection(`organizations/${orgId}/stores`).get(),
  ])
  const importedNames = new Set(stores.docs.map(store => store.get('gbpLocationName')).filter(Boolean))
  const candidates: LocationCandidate[] = []
  for (const connection of connections.docs) {
    const accounts = (connection.get('gbpAccounts') ?? []) as { name: string }[]
    try {
      const found = await withConnectionErrors(db, orgId, connection.id, async () => {
        const client = await createGbpClientForConnection(db, orgId, connection.id, deps)
        const perAccount = await Promise.all(accounts.map(async account =>
          (await client.listLocations(account.name, LOCATION_READ_MASK)).map(location => toCandidate(connection.id, account.name, location))))
        return perAccount.flat()
      })
      candidates.push(...found.map(candidate => ({ ...candidate, isImported: importedNames.has(candidate.locationName) })))
    }
    catch (error) {
      // 再認証が必要な連携は画面で案内されるため、他の連携の候補は返す
      if ((error as { code?: string }).code === 'failed-precondition' || error instanceof GbpAuthError) {
        logger.warn('Google 連携の再認証が必要です', { orgId, connectionId: connection.id })
        continue
      }
      throw error
    }
  }
  return candidates
}

export async function getGbpLocationsFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<LocationCandidate[]> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  return collectCandidates(db, orgId, deps)
}

export async function createStoresFromGbpFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<{ storeIds: string[] }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const locationNames = requireStringArray(input.locationNames, '取り込むロケーション', 100)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])

  // クライアントから受け取った値は使わず、GBP から取り直した候補だけを取り込む
  const selected = (await collectCandidates(db, orgId, deps))
    .filter(candidate => locationNames.includes(candidate.locationName) && candidate.isImportable && !candidate.isImported)

  return db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    const active = await tx.get(db.collection(`organizations/${orgId}/stores`).where('status', '==', 'active'))
    const refs = selected.map(candidate => db.doc(`organizations/${orgId}/stores/${storeIdFromLocation(candidate.locationName)}`))
    const existing = await Promise.all(refs.map(ref => tx.get(ref)))
    const toCreate = selected.filter((_, index) => !existing[index].exists)
    if (active.size + toCreate.length > org.limits.maxStores) {
      fail('resource-exhausted', `店舗数の上限（${org.limits.maxStores} 店舗）を超えます。`)
    }
    for (const candidate of toCreate) {
      tx.create(db.doc(`organizations/${orgId}/stores/${storeIdFromLocation(candidate.locationName)}`), {
        orgId,
        name: candidate.title,
        address: candidate.address,
        location: new GeoPoint(candidate.lat, candidate.lng),
        connectionId: candidate.connectionId,
        gbpAccountName: candidate.accountName,
        gbpLocationName: candidate.locationName,
        placeId: candidate.placeId,
        reviewUrl: buildReviewUrl(candidate.placeId!),
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    const storeIds = toCreate.map(candidate => storeIdFromLocation(candidate.locationName))
    if (storeIds.length > 0) writeAuditLog(tx, db, orgId, 'store.importFromGbp', caller.uid, { storeIds })
    return { storeIds }
  })
}

export async function updateStoreArchiveFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const ref = db.doc(`organizations/${orgId}/stores/${storeId}`)
    if (!(await tx.get(ref)).exists) fail('not-found', '店舗が見つかりません。')
    tx.update(ref, { status: 'archived', archivedAt: FieldValue.serverTimestamp() })
    writeAuditLog(tx, db, orgId, 'store.archive', caller.uid, { storeId })
  })
}
```

> アンケートの公開停止（モックの `updateStoreArchiveFunc` が行っている処理）は、アンケートを Firestore に本接続する計画で追加する（現時点で Firestore にアンケートは無い）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（50 件 + stores 8 件 = 58 件）

- [ ] **Step 5: callable とコールバックを公開する**

`functions/src/index.ts` の import に追加する。

```ts
import {onRequest} from "firebase-functions/https";
import { getFirestore } from "firebase-admin/firestore";
import { createGoogleAuthUrlFunc, deleteGoogleConnectionFunc, handleGoogleOAuthCallback } from "./google/connect";
import { deleteGoogleOAuthClientFunc, getGoogleOAuthConfigFunc, updateGoogleOAuthClientFunc } from "./google/oauthClient";
import { createStoresFromGbpFunc, getGbpLocationsFunc, updateStoreArchiveFunc } from "./stores/stores";
```

（`onRequest` の import は既存行をそのまま使う）

末尾に追加する。

```ts
// google/ … OAuth クライアント・Google 連携（F-04）
export const updateGoogleOAuthClient = callable(updateGoogleOAuthClientFunc);
export const deleteGoogleOAuthClient = callable(deleteGoogleOAuthClientFunc);
export const getGoogleOAuthConfig = callable(getGoogleOAuthConfigFunc);
export const createGoogleAuthUrl = callable(createGoogleAuthUrlFunc);
export const deleteGoogleConnection = callable((db, caller, data) => deleteGoogleConnectionFunc(db, caller, data));
export const googleOAuthCallback = onRequest(async (req, res) => {
  const pick = (value: unknown) => (typeof value === "string" ? value : undefined);
  const redirect = await handleGoogleOAuthCallback(getFirestore(), {
    code: pick(req.query.code),
    state: pick(req.query.state),
    error: pick(req.query.error),
  });
  res.redirect(302, redirect);
});

// stores/ … 店舗の取込・管理（F-05）
export const getGbpLocations = callable((db, caller, data) => getGbpLocationsFunc(db, caller, data));
export const createStoresFromGbp = callable((db, caller, data) => createStoresFromGbpFunc(db, caller, data));
export const updateStoreArchive = callable(updateStoreArchiveFunc);
```

> `deps` を省略した呼び出しにするため、4 引数のハンドラーは無名関数で包む（`callable` は 3 引数のハンドラーを受ける）。

Run: `cd functions && npm run build && npm test`
Expected: ビルド成功、単体テスト 49 件 PASS

---

### Task 6: クライアントの型・変換・モック

**Files:**
- Modify: `app/types/domain.ts`
- Modify: `app/utils/firebase/converters.ts`
- Modify: `app/utils/mock/functions/google.ts`

**Interfaces:**
- Consumes: Task 5 のレスポンス形
- Produces:
  - `Organization.googleOAuthClient?: { clientId: string; configuredAt: string } | null`
  - `GbpLocation.accountName?: string`
  - `toOrganization` が `googleOAuthClient` を変換する
  - モック: `updateGoogleOAuthClientFunc(db, uid, orgId, clientId)` / `deleteGoogleOAuthClientFunc(db, uid, orgId)`（モックはシークレットを保持しない）

- [ ] **Step 1: 型を追加する**

`app/types/domain.ts` の `Organization` に追加する（`createdAt` の後）。

```ts
  /** 組織が登録した Google OAuth クライアント（シークレットは Functions 側にだけある） */
  googleOAuthClient?: { clientId: string; configuredAt: string } | null
```

`GbpLocation` の `connectionId` の後に追加する。

```ts
  /** 取込時に店舗へ保存する GBP アカウント名（accounts/...）。モックでは省略 */
  accountName?: string
```

- [ ] **Step 2: 変換を更新する**

`app/utils/firebase/converters.ts` の `toOrganization` の戻り値に追加する。

```ts
    googleOAuthClient: data.googleOAuthClient
      ? { clientId: data.googleOAuthClient.clientId, configuredAt: toIso(data.googleOAuthClient.configuredAt) }
      : null,
```

- [ ] **Step 3: モックに OAuth クライアント登録を追加する**

`app/utils/mock/functions/google.ts` の `createGoogleConnectionFunc` の前に追加する。

```ts
/** モックではクライアント ID だけを組織に記録する（シークレットは保持しない） */
export function updateGoogleOAuthClientFunc(db: MockDb, uid: string, orgId: string, clientId: string): void {
  const org = requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner'])
  if (!clientId.trim().endsWith('.apps.googleusercontent.com')) {
    throw new MockFunctionsError('invalid-argument', 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。')
  }
  org.googleOAuthClient = { clientId: clientId.trim(), configuredAt: new Date().toISOString() }
}

export function deleteGoogleOAuthClientFunc(db: MockDb, uid: string, orgId: string): void {
  const org = requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner'])
  if (db.googleConnections.some(item => item.orgId === orgId && item.status !== 'revoked')) {
    throw new MockFunctionsError('failed-precondition', '連携中の Google アカウントがあります。先に連携を解除してください。')
  }
  org.googleOAuthClient = null
}
```

- [ ] **Step 4: 型チェックを確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

---

### Task 7: 連携・店舗の composable と設定画面

**Files:**
- Modify: `app/composables/useGoogleConnection.ts`
- Modify: `app/composables/useStores.ts`
- Modify: `app/composables/useAdminNav.ts`（`FIREBASE_READY_PATHS` に `/settings/google` と `/stores`）
- Create: `app/components/Settings/Google/SetupGuide.vue`
- Create: `app/components/Settings/Google/OAuthClientForm.vue`
- Modify: `app/pages/admin/[orgId]/settings/google.vue`

**Interfaces:**
- Consumes: Task 5 の callable、Task 6 の型
- Produces:
  - `useGoogleConnection()` の戻り値に `oauthClient: ComputedRef<{ clientId; configuredAt } | null>` / `callbackUrl: Ref<string | null>` / `loadCallbackUrl(): Promise<void>` / `registerOAuthClient(clientId, clientSecret): Promise<void>` / `removeOAuthClient(): Promise<void>` / `startGoogleAuth(): Promise<void>` を追加。`connect(email)` / `reauthorize(id)` / `disconnect(id)` は維持（本物モードの `reauthorize` は `startGoogleAuth` と同じ）
  - `GOOGLE_CALLBACK_ERRORS: Record<string, string>`（コールバックのエラーコード → 画面のメッセージ）

- [ ] **Step 1: `useGoogleConnection` を書き換える**

`app/composables/useGoogleConnection.ts`:

```ts
import { callFunction } from '~/utils/firebase/callFunction'
import {
  createGoogleConnectionFunc,
  deleteGoogleConnectionFunc,
  deleteGoogleOAuthClientFunc,
  updateGoogleConnectionReauthFunc,
  updateGoogleOAuthClientFunc,
} from '~/utils/mock/functions/google'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-04 Google Business Profile 連携。
// 本物モードは組織の OAuth クライアントで Google の同意画面へ移動し、コールバック後に設定画面へ戻る。
// モックでは入力したアカウントで即時に連携する。

/** googleOAuthCallback が付けて戻すエラーコード */
export const GOOGLE_CALLBACK_ERRORS: Record<string, string> = {
  access_denied: 'Google の同意画面でアクセスが許可されませんでした。',
  invalid_client: 'OAuth クライアントの設定が正しくありません。クライアント ID・シークレットと、承認済みのリダイレクト URI を確認してください。',
  exchange_failed: 'Google との認証に失敗しました。時間をおいて再度お試しください。',
  no_refresh_token: 'Google から長期利用の許可（refresh token）を受け取れませんでした。Google アカウントの「サードパーティによるアクセス」から一度アクセス権を削除して、もう一度連携してください。',
  gbp_accounts_failed: 'ビジネスプロフィールのアカウントを取得できませんでした。GBP API の利用承認と、連携したアカウントがビジネスプロフィールの管理者になっているかを確認してください。',
  invalid_state: '連携の有効期限が切れました。もう一度「Google で連携する」からやり直してください。',
}

export function useGoogleConnection() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, org } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const connections = computed(() => db.value.googleConnections.filter(item => item.orgId === orgId.value))
  const activeConnections = computed(() => connections.value.filter(item => item.status === 'active'))
  const hasError = computed(() => connections.value.some(item => item.status === 'error'))
  const isConnected = computed(() => activeConnections.value.length > 0)
  const oauthClient = computed(() => org.value?.googleOAuthClient ?? null)
  const callbackUrl = ref<string | null>(null)

  async function loadCallbackUrl(): Promise<void> {
    if (isMock) {
      callbackUrl.value = 'https://asia-northeast1-<プロジェクト ID>.cloudfunctions.net/googleOAuthCallback'
      return
    }
    const result = await callFunction<object, { callbackUrl: string }>($functions, 'getGoogleOAuthConfig', { orgId: orgId.value })
    callbackUrl.value = result.callbackUrl
  }

  async function registerOAuthClient(clientId: string, clientSecret: string): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateGoogleOAuthClient', { orgId: orgId.value, clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      return
    }
    await mockLatency()
    updateGoogleOAuthClientFunc(db.value, user.value!.uid, orgId.value, clientId)
  }

  async function removeOAuthClient(): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'deleteGoogleOAuthClient', { orgId: orgId.value })
      return
    }
    await mockLatency()
    deleteGoogleOAuthClientFunc(db.value, user.value!.uid, orgId.value)
  }

  /** Google の同意画面へ移動する（戻り先は Functions のコールバックが決める） */
  async function startGoogleAuth(): Promise<void> {
    const { url } = await callFunction<object, { url: string }>($functions, 'createGoogleAuthUrl', { orgId: orgId.value })
    window.location.assign(url)
  }

  async function connect(googleEmail: string) {
    await mockLatency(800)
    return createGoogleConnectionFunc(db.value, user.value!.uid, orgId.value, googleEmail.trim())
  }

  async function reauthorize(connectionId: string) {
    if (!isMock) return startGoogleAuth()
    await mockLatency(800)
    updateGoogleConnectionReauthFunc(db.value, user.value!.uid, orgId.value, connectionId)
  }

  async function disconnect(connectionId: string) {
    if (!isMock) {
      await callFunction($functions, 'deleteGoogleConnection', { orgId: orgId.value, connectionId })
      return
    }
    await mockLatency()
    deleteGoogleConnectionFunc(db.value, user.value!.uid, orgId.value, connectionId)
  }

  return {
    connections,
    activeConnections,
    hasError,
    isConnected,
    oauthClient,
    callbackUrl,
    loadCallbackUrl,
    registerOAuthClient,
    removeOAuthClient,
    startGoogleAuth,
    connect,
    reauthorize,
    disconnect,
  }
}
```

- [ ] **Step 2: `useStores` に本物モードを追加する**

`app/composables/useStores.ts` の import に追加する。

```ts
import { callFunction } from '~/utils/firebase/callFunction'
```

`useStores()` の冒頭に追加する。

```ts
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
```

3 つの操作を次にする。

```ts
  async function fetchGbpCandidates(): Promise<GbpLocationCandidate[]> {
    if (!isMock) return callFunction($functions, 'getGbpLocations', { orgId: orgId.value })
    await mockLatency()
    return getGbpLocationsFunc(db.value, user.value!.uid, orgId.value)
  }

  /** 取り込んだ店舗の件数を返す */
  async function importStores(locationNames: string[]): Promise<{ length: number }> {
    if (!isMock) {
      const { storeIds } = await callFunction<object, { storeIds: string[] }>($functions, 'createStoresFromGbp', { orgId: orgId.value, locationNames })
      return storeIds
    }
    await mockLatency()
    return createStoresFromGbpFunc(db.value, user.value!.uid, orgId.value, locationNames)
  }

  async function archiveStore(storeId: string) {
    if (!isMock) {
      await callFunction($functions, 'updateStoreArchive', { orgId: orgId.value, storeId })
      return
    }
    await mockLatency()
    updateStoreArchiveFunc(db.value, user.value!.uid, orgId.value, storeId)
  }
```

> `GbpImportModal.vue` は戻り値の `length` だけを使う（`emit('imported', created.length)`）。

- [ ] **Step 3: 本接続済みの画面を追加する**

`app/composables/useAdminNav.ts`:

```ts
const FIREBASE_READY_PATHS = ['/settings/organization', '/settings/members', '/settings/google', '/stores']
```

- [ ] **Step 4: 設定画面の部品を作る**

`app/components/Settings/Google/SetupGuide.vue`:

```vue
<script setup lang="ts">
// 組織ごとに自社の GCP で GBP API と OAuth クライアントを用意してもらうための手順

interface Props {
  callbackUrl: string | null
}

defineProps<Props>()
</script>

<template>
  <ol class="list-decimal space-y-3 pl-5 text-sm text-slate-700">
    <li>
      Google Cloud でプロジェクトを作成し、<span class="font-medium">Google Business Profile API の利用申請</span>を行います。
      承認後、「My Business Account Management API」「My Business Business Information API」「Google My Business API」を有効にします。
    </li>
    <li>
      「OAuth 同意画面」を設定し、公開ステータスを<span class="font-medium">「本番環境」</span>にします。
      <span class="text-rose-700">「テスト」のままだと 7 日で連携が切れます。</span>
    </li>
    <li>
      「認証情報」で OAuth クライアント ID（種類: ウェブアプリケーション）を作成し、「承認済みのリダイレクト URI」に次の URL を登録します。
      <div v-if="callbackUrl" class="mt-2 flex flex-wrap items-center gap-2">
        <code class="rounded bg-slate-100 px-2 py-1 text-xs break-all">{{ callbackUrl }}</code>
        <UiCommonButton size="sm" variant="secondary" icon="copy" @click="copyToClipboard(callbackUrl, 'リダイレクト URI をコピーしました')">コピー</UiCommonButton>
      </div>
    </li>
    <li>作成したクライアント ID とクライアントシークレットを下のフォームに登録します。</li>
    <li>「Google で連携する」を押し、ビジネスプロフィールのオーナーまたは管理者の Google アカウントで許可します。</li>
  </ol>
</template>
```

`app/components/Settings/Google/OAuthClientForm.vue`:

```vue
<script setup lang="ts">
// 組織の OAuth クライアントの登録・変更（owner のみ）

interface Props {
  currentClientId: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ saved: [] }>()

const { registerOAuthClient } = useGoogleConnection()
const { isPending, errorMessage, run } = useActionState()

const clientId = ref(props.currentClientId ?? '')
const clientSecret = ref('')
const canSubmit = computed(() => clientId.value.trim() !== '' && clientSecret.value.trim() !== '')

async function onSubmit(): Promise<void> {
  const isDone = await run(async () => {
    await registerOAuthClient(clientId.value, clientSecret.value)
    return true
  })
  if (!isDone) return
  clientSecret.value = ''
  emit('saved')
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <UiInputTextField
      v-model="clientId"
      label="クライアント ID"
      placeholder="123456789-xxxx.apps.googleusercontent.com"
      is-required
    />
    <UiInputTextField
      v-model="clientSecret"
      label="クライアントシークレット"
      type="password"
      autocomplete="off"
      :hint="currentClientId ? '変更する場合だけ入力してください。登録済みのシークレットは表示できません' : '暗号化して保存し、画面には表示しません'"
      is-required
    />
    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <div class="flex justify-end">
      <UiCommonButton type="submit" :is-loading="isPending" :is-disabled="!canSubmit">
        {{ currentClientId ? '更新する' : '登録する' }}
      </UiCommonButton>
    </div>
  </form>
</template>
```

> `UiCommonButton` が `isDisabled` を受けない場合は `app/components/Ui/Common/Button.vue` の props 名に合わせる（実装時に確認）。

- [ ] **Step 5: 設定画面に本物モードの UI を加える**

`app/pages/admin/[orgId]/settings/google.vue` の `<script setup>` を次の差分で変更する。

`useGoogleConnection()` の分割代入を置き換える。

```ts
const { isOwner } = useCurrentOrg()
const isMock = useRuntimeConfig().public.useMock
const route = useRoute()
const router = useRouter()
const {
  connections,
  oauthClient,
  callbackUrl,
  loadCallbackUrl,
  removeOAuthClient,
  startGoogleAuth,
  connect,
  reauthorize,
  disconnect,
} = useGoogleConnection()
```

（`const { adminPath } = useCurrentOrg()` は `const { adminPath, isOwner } = useCurrentOrg()` にまとめ、上の `const { isOwner } = useCurrentOrg()` は書かない）

`sortedConnections` の後に追加する。

```ts
const authState = useActionState()
const removeClientState = useActionState()
const isClientFormOpen = ref(false)

/** コールバックから戻ったときの結果（?connected=1 / ?error=...）を一度だけ表示する */
const callbackError = ref<string | null>(null)
onMounted(async () => {
  void loadCallbackUrl().catch(() => { callbackUrl.value = null })
  const { connected, error, ...rest } = route.query
  if (connected === '1') show('Google と連携しました')
  if (typeof error === 'string') callbackError.value = GOOGLE_CALLBACK_ERRORS[error] ?? GOOGLE_CALLBACK_ERRORS.exchange_failed!
  if (connected || error) await router.replace({ query: rest })
})

async function onStartGoogleAuth(): Promise<void> {
  await authState.run(startGoogleAuth)
}

async function onRemoveClient(): Promise<void> {
  await removeClientState.run(removeOAuthClient)
  if (!removeClientState.errorMessage.value) show('OAuth クライアントを削除しました')
}
```

テンプレートの「連携中のアカウント」カードの前に、本物モード・モック共通の OAuth クライアントカードを追加する。

```vue
    <UiCommonCard title="OAuth クライアント">
      <div class="space-y-4">
        <SettingsGoogleSetupGuide :callback-url="callbackUrl" />
        <div v-if="oauthClient" class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div>
            <p class="font-medium break-all text-slate-900">{{ oauthClient.clientId }}</p>
            <p class="text-xs text-slate-500">登録日 {{ formatDate(oauthClient.configuredAt) }}</p>
          </div>
          <div v-if="isOwner" class="flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="isClientFormOpen = !isClientFormOpen">変更</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" :is-loading="removeClientState.isPending.value" @click="onRemoveClient">削除</UiCommonButton>
          </div>
        </div>
        <UiCommonAlert v-if="removeClientState.errorMessage.value" tone="danger">{{ removeClientState.errorMessage.value }}</UiCommonAlert>
        <SettingsGoogleOAuthClientForm
          v-if="isOwner && (!oauthClient || isClientFormOpen)"
          :current-client-id="oauthClient?.clientId ?? null"
          @saved="isClientFormOpen = false; show('OAuth クライアントを登録しました')"
        />
        <p v-else-if="!oauthClient" class="text-sm text-slate-500">OAuth クライアントの登録はオーナーが行います。</p>
      </div>
    </UiCommonCard>

    <UiCommonAlert v-if="callbackError" tone="danger">{{ callbackError }}</UiCommonAlert>
```

「Google と連携する」カードの中身を、本物モードとモックで出し分ける（既存の `<form>` 全体を `v-if="isMock"` の `template` で包み、本物モードの UI を `v-else` で加える）。

```vue
    <UiCommonCard title="Google と連携する">
      <template v-if="isMock">
        <!-- 既存の <form class="space-y-4" @submit.prevent="onConnect"> ... </form> をそのまま置く -->
      </template>
      <div v-else class="space-y-4">
        <p class="text-sm text-slate-700">
          ビジネスプロフィールのオーナーまたは管理者の Google アカウントで、管理権限（business.manage）を許可します。
        </p>
        <UiCommonAlert v-if="authState.errorMessage.value" tone="danger">{{ authState.errorMessage.value }}</UiCommonAlert>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <NuxtLink :to="adminPath('/stores')" class="text-sm text-brand-700 hover:underline">連携後は店舗画面から取り込めます</NuxtLink>
          <UiCommonButton icon="google" :is-loading="authState.isPending.value" :is-disabled="!oauthClient" @click="onStartGoogleAuth">
            Google で連携する
          </UiCommonButton>
        </div>
      </div>
    </UiCommonCard>
```

- [ ] **Step 6: 型チェックとモックの表示を確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

Run: `npm run dev`（モック）で法人オーナーとしてログインし、Google 連携画面に「OAuth クライアント」カードが出て、クライアント ID を登録できる（形式違いはエラー）・既存のメール入力の連携が従来どおり動くこと

---

### Task 8: Emulator での確認と PROJECT.md

**Files:**
- Modify: `.claude/PROJECT.md`

**Interfaces:**
- Consumes: Task 1〜7 のすべて
- Produces: なし

- [ ] **Step 1: Emulator と本物モードを起動する**

Functions の環境変数はシェルから渡す（`.env` 系ファイルは作らない）。

Run（バックグラウンド）: `cd functions && npm run build && cd .. && OAUTH_CALLBACK_URL=http://127.0.0.1:5001/meo-tool-d98e5/asia-northeast1/googleOAuthCallback ADMIN_APP_URL=http://localhost:3101 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:start --only auth,firestore,functions`

Run（バックグラウンド）: `NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=true npx nuxt dev --port 3101`

> Functions Emulator にシェルの環境変数が渡らない場合は、`firebase.json` を変えずに、ledger に記録したうえで `functions/.env.local` の作成をユーザーに依頼する。

- [ ] **Step 2: 操作を確認する**

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 法人で新規登録 → Google 連携画面 | 手順ガイドにリダイレクト URI（Emulator の URL）が表示される。「Google で連携する」は無効 |
| 2 | クライアント ID に `abc` を入れて登録 | 形式エラー |
| 3 | 正しい形式の ID とシークレットを登録 | 登録済み表示に変わる（ID と登録日）。Emulator の Firestore で `oauthClientSecrets` にシークレットの平文が無い |
| 4 | 「Google で連携する」 | `accounts.google.com` の認可画面へ移動する（URL の `client_id` が登録した ID、`redirect_uri` が Emulator の URL）。実際の同意はテスト用 OAuth クライアントが無い限り行わない |
| 5 | `/admin/{orgId}/settings/google?error=invalid_client` を開く | 原因別のエラーメッセージが出て、URL から `error` が消える |
| 6 | 店舗画面 | 「準備中」にならず、店舗 0 件で表示される |
| 7 | admin で同じ組織に参加しログイン | OAuth クライアントのフォームが出ず「オーナーが行います」 |

- [ ] **Step 3: モックの退行がないことを確認する**

Run: `npm run dev`（環境変数なし）で、デモの法人オーナーで Google 連携（メール入力）→ 店舗画面で取込、店舗のアーカイブが従来どおり動くこと

- [ ] **Step 4: `.claude/PROJECT.md` に追記する**

「Functions」の表の後に追加する。

```markdown
### Functions の環境変数

| キー | 用途 | 例 |
| --- | --- | --- |
| `OAUTH_CALLBACK_URL` | `googleOAuthCallback` の URL。各組織が自社 OAuth クライアントのリダイレクト URI に登録する | `https://asia-northeast1-meo-tool-d98e5.cloudfunctions.net/googleOAuthCallback` |
| `ADMIN_APP_URL` | コールバック後に戻す管理画面のオリジン | `https://<本番ドメイン>` |
| `KMS_KEY_NAME` | 秘密（OAuth シークレット・refresh token）の暗号鍵 | `projects/meo-tool-d98e5/locations/asia-northeast1/keyRings/meo-tool/cryptoKeys/oauth-secrets` |
| `SECRET_CIPHER` | `local` で Emulator 用のローカル暗号を使う（本番では設定しない） | |

本番デプロイ前に Cloud KMS で鍵リングと鍵を作り、Functions の実行サービスアカウントに「Cloud KMS 暗号鍵の暗号化 / 復号」ロールを付与する。
```

「Firestore」の表に行を追加する。

```markdown
| 秘密のコレクション | `oauthClientSecrets/{orgId}`・`oauthTokens/{connectionId}`・`oauthStates/{state}`（ルールで全拒否。Functions のみ） |
```

- [ ] **Step 5: 全テストを最終確認する**

Run: `cd functions && npm test && npm run build`、ルートで `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`、`npm run typecheck`
Expected: 単体 49 件 PASS、Emulator 58 件 PASS、ビルド成功、型エラー 0 件

---

## 完了条件

- Functions の単体テスト 49 件・Emulator テスト 58 件がすべて PASS、型エラー 0 件
- 本物モードで OAuth クライアントを登録でき、Google の認可画面へ正しいパラメータで移動する
- 店舗画面・Google 連携画面が本物モードで「準備中」にならない
- モックの Google 連携・店舗取込・アーカイブが従来どおり動く
- 実際の Google 同意 → 連携 → 取込は、GBP API の承認とテスト用 OAuth クライアントが用意できた時点で確認する（本計画の範囲外）
