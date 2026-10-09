# 接続先とデモ判定の変更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面を常に本番の Firebase に接続し、モックかどうかをデモアカウント 3 人でのログインで実行時に決め、localhost では Functions だけを `127.0.0.1:5001` の Emulator に向ける。

**Architecture:** ビルド時フラグ（`runtimeConfig.public.useMock` / `useEmulator`）を廃止し、`useDemoSession()` の `isMock: ComputedRef<boolean>` に置き換える。`useAppDb()` は仮データと Firestore 購読データを `isMock` で切り替える computed を返し、Firestore 購読は専用の `useFirestoreDb()` にだけ書き込む。Functions 側は「データも Emulator のときだけローカル用の値」を `isFullyEmulated()` で判定する。

**Tech Stack:** Nuxt 4 SPA（`ssr: false`）、Firebase JS SDK v12、Cloud Functions v7（Node 24、`node:test`）

**Spec:** `docs/superpowers/specs/2026-10-09-connection-mode-design.md`

## Global Constraints

- **コミットしない。** 計画中の「Commit」手順はすべて「`git status` で変更ファイルを確認する」に読み替える（ユーザーの明示許可がない限り commit しない）
- コメント・UI 文言は日本語。コメントは意図が分かりにくい箇所にだけ簡潔に
- app 側のコードスタイルは周囲に合わせる（`app/plugins/firebase.client.ts` はダブルクォート + セミコロン、それ以外の app コードはシングルクォート・セミコロンなし）
- デモアカウントは `DEMO_ACCOUNTS`（`app/utils/mock/seed.ts`）の 3 人（`u-kobayashi` / `u-tanaka` / `u-sato`）だけ
- localStorage のキーは `meo-tool:mock-uid`（既存と同じ）
- Functions Emulator のホストとポートは `127.0.0.1` / `5001`
- 生成物（`.nuxt/` `.output/` `functions/lib/` `functions/lib-test/`）は編集しない
- 使われなくなったコード（モックの関数など）は残さない
- 過去の仕様書・計画書（`docs/superpowers/specs/2026-10-0[78]-*` `docs/superpowers/plans/2026-10-0[78]-*`）は履歴なので書き換えない

## Review Focus

1. **再読み込み直後のデモ**：localStorage にデモの uid がある状態で `/admin/...` を直接開くと、Firebase Auth の確定を待たずに（`waitForAuth` が即座に解決して）仮データの管理画面が出る
2. **本番ログイン中にデモボタン**：Firebase からログアウトされ、Firestore 購読の DB が空に戻り、`user` が仮データのユーザーに切り替わる。本番の組織が仮データに混ざらない
3. **古い localStorage**：`meo-tool:mock-uid` に `u-ops` や `u-suzuki` が残っていても、未ログイン扱いになる（運営画面に入れない）
4. **本番ドメイン**：`localhost` / `127.0.0.1` 以外では `connectFunctionsEmulator` を呼ばない
5. **Functions Emulator だけの起動**：`FUNCTIONS_EMULATOR=true` でも `FIRESTORE_EMULATOR_HOST` が無ければ、ローカル暗号・固定ソルトを使わない

---

### Task 1: Functions の「データも Emulator か」判定

**Files:**
- Create: `functions/src/shared/emulator.ts`
- Create: `functions/src/shared/__tests__/emulator.test.ts`
- Modify: `functions/src/shared/secrets.ts:65-67`
- Modify: `functions/src/responses/ipHash.ts:14-19`
- Modify: `functions/src/responses/__tests__/ipHash.test.ts`
- Modify: `functions/src/shared/__tests__/secrets.test.ts`

**Interfaces:**
- Produces: `isFullyEmulated(env?: NodeJS.ProcessEnv): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/shared/__tests__/emulator.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFullyEmulated } from '../emulator'

test('isFullyEmulated: Functions Emulator かつ Firestore Emulator のときだけ true', () => {
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), true)
})

test('isFullyEmulated: Functions Emulator だけ（データは本番）なら false', () => {
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true', FIRESTORE_EMULATOR_HOST: '' }), false)
})

test('isFullyEmulated: Functions Emulator でなければ false', () => {
  assert.equal(isFullyEmulated({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), false)
  assert.equal(isFullyEmulated({}), false)
})
```

`functions/src/responses/__tests__/ipHash.test.ts` の 3 つ目のテストを、次の内容に置き換える（`saved` / `restore` に `FIRESTORE_EMULATOR_HOST` を足し、Functions Emulator だけのケースを追加する）:

```ts
test('getIpHashSalt: 環境変数を使い、未設定ならデータも Emulator のときだけ固定値・それ以外はエラー', () => {
  type Key = 'IP_HASH_SALT' | 'FUNCTIONS_EMULATOR' | 'FIRESTORE_EMULATOR_HOST'
  const keys: Key[] = ['IP_HASH_SALT', 'FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<Key, string | undefined>
  const rejected = {
    code: 'failed-precondition',
    message: '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。',
  }
  try {
    process.env.IP_HASH_SALT = 'from-env'
    assert.equal(getIpHashSalt(), 'from-env')
    delete process.env.IP_HASH_SALT
    process.env.FUNCTIONS_EMULATOR = 'true'
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    assert.equal(getIpHashSalt(), 'meo-tool-local-ip-salt')
    // Functions だけ Emulator（データは本番）では固定ソルトを使わない
    delete process.env.FIRESTORE_EMULATOR_HOST
    assert.throws(() => getIpHashSalt(), rejected)
    delete process.env.FUNCTIONS_EMULATOR
    assert.throws(() => getIpHashSalt(), rejected)
  }
  finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})
```

`functions/src/shared/__tests__/secrets.test.ts` の `beforeEach` に `delete process.env.FIRESTORE_EMULATOR_HOST` を足し、末尾に次のテストを追加する:

```ts
test('Functions Emulator だけ（データは本番）ではローカル暗号を使わず、KMS_KEY_NAME が無ければ failed-precondition', async () => {
  delete process.env.SECRET_CIPHER
  process.env.FUNCTIONS_EMULATOR = 'true'
  await assert.rejects(encryptSecret('x'), { code: 'failed-precondition' })
})

test('Functions と Firestore の両方が Emulator ならローカル暗号を使う', async () => {
  delete process.env.SECRET_CIPHER
  process.env.FUNCTIONS_EMULATOR = 'true'
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  const secret = await encryptSecret('x')
  assert.equal(await decryptSecret(secret), 'x')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL（`../emulator` が見つからない tsc エラー）

- [ ] **Step 3: 実装する**

`functions/src/shared/emulator.ts`:

```ts
/**
 * Functions も Firestore も Emulator で動いているか（＝データも偽物）。
 * Functions だけを Emulator で動かす構成（npm --prefix functions run serve）では本番の Firestore を読み書きするため、
 * ローカル用の暗号やソルトを使うと本番のデータと食い違う。その判定に使う。
 */
export function isFullyEmulated(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === 'true' && !!env.FIRESTORE_EMULATOR_HOST
}
```

`functions/src/shared/secrets.ts` の `isLocalAllowed` を次にする（import を先頭の import 群に追加）:

```ts
import { isFullyEmulated } from './emulator'
```

```ts
function isLocalAllowed(): boolean {
  return process.env.SECRET_CIPHER === 'local' || isFullyEmulated()
}
```

`functions/src/responses/ipHash.ts` を次にする（import を追加し、`getIpHashSalt` のコメントと判定を変える。`EMULATOR_SALT` のコメントも「データも Emulator のとき・テスト専用」に変える）:

```ts
import { isFullyEmulated } from '../shared/emulator'
```

```ts
/** データも Emulator のとき・テスト専用。コードに固定されているため本番では使わない */
const EMULATOR_SALT = 'meo-tool-local-ip-salt'
```

```ts
/** IP_HASH_SALT（環境変数）。未設定ならデータも Emulator のときだけ固定値、それ以外は受け付けない（secrets.ts の判定に合わせる） */
export function getIpHashSalt(): string {
  const salt = process.env.IP_HASH_SALT
  if (salt) return salt
  if (isFullyEmulated()) return EMULATOR_SALT
  return fail('failed-precondition', '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。')
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS（fail 0）

Run: `npm --prefix functions run build`
Expected: エラーなし

Run: `npm run test:emulator`
Expected: PASS（fail 0。Firestore Emulator 上なので `FIRESTORE_EMULATOR_HOST` が入る。Java 21 が必要: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`）

- [ ] **Step 5: 変更を確認する（コミットしない）**

Run: `git status --short functions/src`

---

### Task 2: 接続とデモ判定の土台

**Files:**
- Create: `app/utils/firebase/isLocalHost.ts`
- Create: `app/utils/mock/demo.ts`
- Create: `app/composables/useDemoSession.ts`
- Create: `app/composables/useFirestoreDb.ts`
- Modify: `app/composables/useAppDb.ts`
- Modify: `app/composables/useFirestoreSync.ts`（`useAppDb()` → `useFirestoreDb()`、冒頭コメント）
- Modify: `app/plugins/firestore-sync.client.ts`
- Modify: `app/plugins/firebase.client.ts`
- Modify: `app/composables/useBackendReady.ts`

**Interfaces:**
- Produces:
  - `isLocalHost(hostname: string): boolean`
  - `isDemoUid(uid: string | null | undefined): uid is string`
  - `useDemoSession(): { demoUid: Ref<string | null>; isMock: ComputedRef<boolean>; enterDemo(uid: string): void; leaveDemo(): void }`
  - `useFirestoreDb(): Ref<MockDb>`
  - `useAppDb(): ComputedRef<MockDb>`（今は `Ref<MockDb>`。`.value` のプロパティへの代入・配列操作は今まで通り使える。`.value` 自体への代入は不可）
- この Task では `runtimeConfig.public.useMock` / `useEmulator` を**まだ消さない**（Task 4 で消す）。`firebase.client.ts` の `useEmulator` 参照だけはこの Task で消える

- [ ] **Step 1: 純粋関数を作る**

`app/utils/firebase/isLocalHost.ts`:

```ts
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1']

/** 手元の開発サーバーで開いているか。true なら Functions を手元の Emulator に向ける */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname)
}
```

`app/utils/mock/demo.ts`:

```ts
import { DEMO_ACCOUNTS } from './seed'

const DEMO_UIDS: readonly string[] = DEMO_ACCOUNTS.map(account => account.uid)

/** デモアカウント（仮データで動く 3 人）の uid か */
export function isDemoUid(uid: string | null | undefined): uid is string {
  return typeof uid === 'string' && DEMO_UIDS.includes(uid)
}
```

- [ ] **Step 2: `useDemoSession` を作る**

`app/composables/useDemoSession.ts`:

```ts
import { isDemoUid } from '~/utils/mock/demo'

// デモアカウントでログインしているか。ログイン中だけ画面を仮データ（app/utils/mock/）で動かす。
// 状態は localStorage に残し、再読み込みしても保つ。

const STORAGE_KEY = 'meo-tool:mock-uid'

/** デモアカウント以外の uid（旧運営デモの u-ops など）が残っていたら捨てる */
function readStoredUid(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isDemoUid(stored) ? stored : null
  }
  catch {
    return null
  }
}

function writeStoredUid(uid: string | null): void {
  try {
    if (uid) localStorage.setItem(STORAGE_KEY, uid)
    else localStorage.removeItem(STORAGE_KEY)
  }
  catch {
    // ストレージが使えない環境ではメモリ上の状態だけで動かす
  }
}

export function useDemoSession() {
  const demoUid = useState<string | null>('demo-uid', readStoredUid)
  const isMock = computed(() => isDemoUid(demoUid.value))

  function enterDemo(uid: string): void {
    if (!isDemoUid(uid)) return
    demoUid.value = uid
    writeStoredUid(uid)
  }

  function leaveDemo(): void {
    demoUid.value = null
    writeStoredUid(null)
  }

  return { demoUid, isMock, enterDemo, leaveDemo }
}
```

- [ ] **Step 3: DB の切り替え**

`app/composables/useFirestoreDb.ts`:

```ts
import type { MockDb } from '~/utils/mock/seed'
import { createEmptyDb } from '~/utils/firebase/emptyDb'

/** Firestore を購読して流し込む DB。書き込むのは useFirestoreSync だけで、画面は useAppDb() から読む */
export function useFirestoreDb() {
  return useState<MockDb>('firestore-db', createEmptyDb)
}
```

`app/composables/useAppDb.ts` を全体置き換え:

```ts
/**
 * 画面が読むリアクティブ DB。デモアカウントでログイン中は仮データ、それ以外は Firestore を購読して流し込んだもの。
 * どちらも同じ形なので、読み取り側の computed はモードを意識しない。ログインでモードが変わると自動で切り替わる。
 */
export function useAppDb() {
  const { isMock } = useDemoSession()
  const mockDb = useMockDb()
  const firestoreDb = useFirestoreDb()
  return computed(() => (isMock.value ? mockDb.value : firestoreDb.value))
}
```

`app/composables/useFirestoreSync.ts`:
- `refreshAuthUser()` と `startFirestoreSync()` の中の `const db = useAppDb()` を `const db = useFirestoreDb()` にする（ファイル内の `useAppDb` をすべて置き換える）
- 39 行目のコメント `// 本物モードで Firestore を購読し、useAppDb() の DB に流し込む。` を `// Firestore を購読し、useFirestoreDb() の DB に流し込む（画面は useAppDb() 経由で読む）。デモ中は Firebase からログアウトしているので空のまま。` にする

`app/plugins/firestore-sync.client.ts` を全体置き換え:

```ts
// Firestore の購読を常に始める（firebase.client.ts の初期化後に動く）。デモ中は Firebase からログアウトしているので何も読まない
export default defineNuxtPlugin(() => {
  startFirestoreSync()
})
```

- [ ] **Step 4: 接続先**

`app/plugins/firebase.client.ts`:
- import から `connectFirestoreEmulator` / `connectStorageEmulator` / `connectAuthEmulator` を外す（`getFirestore` / `getStorage` / `getAuth` は残す）
- 先頭の import 群に `import { isLocalHost } from "~/utils/firebase/isLocalHost";` を足す
- `// ポートは firebase.json の emulators と合わせる` から始まる `if (config.public.useEmulator) { … }` ブロックを次に置き換える:

```ts
  // Auth / Firestore / Storage は常に本番。手元（localhost）で開いたときだけ Functions を手元の Emulator に向ける。
  // ポートは firebase.json の emulators と合わせる
  if (isLocalHost(window.location.hostname)) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
```

- [ ] **Step 5: `useBackendReady`**

`app/composables/useBackendReady.ts` の `useBackendReady()` を次にする（冒頭コメントは「Firebase Auth の状態と所属組織の初回読み込みが終わったかを持つ。デモ中は待たない。」に変える）:

```ts
export function useBackendReady() {
  const { isMock } = useDemoSession()
  const state = useState<BackendReadyState>('backend-ready', () => ({ isAuthReady: false, isOrgsReady: false }))
  const db = useFirestoreDb()

  return {
    state,
    waitForAuth: () => waitUntil(() => isMock.value || state.value.isAuthReady),
    waitForOrgs: () => waitUntil(() => isMock.value || state.value.isOrgsReady),
    /** 作成・受諾した組織が購読に届くまで待つ（直後の画面遷移でミドルウェアに弾かれないように） */
    waitForOrg: (orgId: string, timeoutMs = 10_000) =>
      waitUntil(() => db.value.organizations.some(org => org.id === orgId)
        && db.value.members.some(member => member.orgId === orgId && member.uid === db.value.users[0]?.uid), timeoutMs),
  }
}
```

`state.value.isAuthReady` / `isOrgsReady` を他で読んでいる箇所があれば（`grep -rn "isAuthReady\|isOrgsReady" app`）、デモ中も正しく動くか確認し、必要なら `isMock.value ||` を同じように足す。

- [ ] **Step 6: 型を確認する**

Run: `npm run typecheck`
Expected: exit 0。`useAppDb()` の戻り値が `ComputedRef` になったことで `db.value = …` の代入エラーが出たら、その箇所は `useFirestoreSync` 以外に無いはずなので報告する（直さずに止まる）

- [ ] **Step 7: 変更を確認する（コミットしない）**

Run: `git status --short app`

---

### Task 3: ログイン・ログアウト（`useAuth` と `login.vue`）

**Files:**
- Modify: `app/composables/useAuth.ts`（全体置き換え）
- Modify: `app/pages/login.vue`
- Possibly delete: `app/utils/mock/functions/identity.ts` の `createOrganizationFunc`（他で使われていなければ）

**Interfaces:**
- Consumes: `useDemoSession()`、`isDemoUid()`、`useFirestoreDb()`、`useMockDb()`（Task 2）
- Produces: `useAuth(): { user; isLoggedIn; login(email, password): Promise<void>; loginAs(uid): Promise<void>; logout(): Promise<void>; signup(input): Promise<string>; registerUser(input): Promise<void>; requestPasswordReset(email): Promise<void> }`（`loginAs` が `Promise<void>` になる点だけ変わる）

- [ ] **Step 1: `useAuth.ts` を置き換える**

```ts
import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import type { OrgType, User } from '~/types/domain'
import { toAuthError } from '~/utils/firebase/authErrors'
import { callFunction } from '~/utils/firebase/callFunction'
import { isDemoUid } from '~/utils/mock/demo'
import { MockFunctionsError, mockLatency } from '~/utils/mock/functions/shared'
import { DEMO_PASSWORD } from '~/utils/mock/seed'

// F-01 認証。デモアカウント 3 人は仮データのユーザーでログイン状態だけを再現し、それ以外は Firebase Auth。
// デモと Firebase のログインは同時に有効にしない（片方に入るときにもう片方から抜ける）。

interface SignupInput {
  type: OrgType
  orgName: string
  displayName: string
  email: string
  password: string
}

export function useAuth() {
  const { demoUid, isMock, enterDemo, leaveDemo } = useDemoSession()
  const mockDb = useMockDb()
  const firestoreDb = useFirestoreDb()
  const { $auth, $functions } = useNuxtApp()
  const { waitForOrg } = useBackendReady()
  // 組織作成の再送用。成功するまで同じ ID を使い、Functions 側の重複防止を効かせる
  const signupRequestId = useState('signup-request-id', () => crypto.randomUUID())

  // Firebase 側は users に自分 1 人だけが入る（useFirestoreSync）
  const user = computed<User | null>(() =>
    isMock.value
      ? mockDb.value.users.find(item => item.uid === demoUid.value) ?? null
      : firestoreDb.value.users[0] ?? null)
  const isLoggedIn = computed(() => user.value !== null)

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

  /** デモアカウント 3 人のうち、メールアドレスが一致する人 */
  function findDemoUser(email: string): User | null {
    const normalized = email.trim().toLowerCase()
    return mockDb.value.users.find(item => isDemoUid(item.uid) && item.email === normalized) ?? null
  }

  /** Firebase からログアウトしてデモに入る。ログアウトに失敗してもデモへの切り替えは続ける（購読側は空になる） */
  async function enterDemoAs(uid: string): Promise<void> {
    if ($auth.currentUser) {
      try {
        await signOut($auth)
      }
      catch {
        // 続行する
      }
    }
    enterDemo(uid)
  }

  async function login(email: string, password: string): Promise<void> {
    const demoUser = findDemoUser(email)
    if (demoUser && password === DEMO_PASSWORD) {
      await mockLatency()
      await enterDemoAs(demoUser.uid)
      return
    }
    leaveDemo()
    try {
      await signInWithEmailAndPassword($auth, email.trim(), password)
    }
    catch (error) {
      throw toAuthError(error)
    }
  }

  /** デモ用: パスワードなしでデモアカウントとしてログインする */
  async function loginAs(targetUid: string): Promise<void> {
    await enterDemoAs(targetUid)
  }

  async function logout(): Promise<void> {
    if (isMock.value) {
      leaveDemo()
      return
    }
    await signOut($auth)
  }

  /** アカウントと組織をまとめて作成し、作成した組織 ID を返す */
  async function signup(input: SignupInput): Promise<string> {
    leaveDemo()
    // 前回の登録が組織作成の途中で失敗していたら、アカウント作成は飛ばして組織作成だけをやり直す
    const currentUser = $auth.currentUser
    if (currentUser?.email?.toLowerCase() === input.email.trim().toLowerCase()) {
      await updateProfile(currentUser, { displayName: input.displayName.trim() })
      refreshAuthUser()
    }
    else {
      await createFirebaseUser(input)
    }
    const { orgId } = await callFunction<object, { orgId: string }>($functions, 'createOrganization', {
      requestId: signupRequestId.value,
      type: input.type,
      orgName: input.orgName.trim(),
      displayName: input.displayName.trim(),
    })
    await waitForOrg(orgId)
    signupRequestId.value = crypto.randomUUID()
    return orgId
  }

  /** 招待から参加する人向け: 組織を作らずにアカウントだけ作成してログインする */
  async function registerUser(input: { displayName: string; email: string; password: string }): Promise<void> {
    leaveDemo()
    await createFirebaseUser(input)
  }

  async function requestPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail($auth, email.trim())
    }
    catch (error) {
      // 登録有無が分からないよう、存在しないメールでも成功扱いにする
      if (error instanceof FirebaseError && error.code === 'auth/user-not-found') return
      throw toAuthError(error)
    }
  }

  return { user, isLoggedIn, login, loginAs, logout, signup, registerUser, requestPasswordReset }
}
```

- [ ] **Step 2: 使われなくなった仮の関数を消す**

Run: `grep -rn "createOrganizationFunc\|createId(" app --include=*.ts --include=*.vue`
- `createOrganizationFunc` が `app/utils/mock/functions/identity.ts` の定義以外で使われていなければ、その関数を削除する（同ファイルの他の関数は残す。関数だけが使っていた import も削除する。ファイルが空になるならファイルごと削除する）
- `createId` は他でも使われているはずなので消さない

- [ ] **Step 3: `login.vue`**

`<script setup>` から `const isMock = useRuntimeConfig().public.useMock` を削除し、`onLoginAs` を次にする:

```ts
async function onLoginAs(uid: string): Promise<void> {
  await loginAs(uid)
  await navigateTo(redirectPath.value)
}
```

テンプレート:
- パスワード欄の `:hint="isMock ? \`デモのパスワードは「${DEMO_PASSWORD}」です\` : undefined"` を `:hint="\`デモアカウントのパスワードは「${DEMO_PASSWORD}」です\`"` にする
- `<section v-if="isMock" …>` の `v-if="isMock"` を外す（常に表示）
- そのセクションの説明文 `ロールや組織種別による画面の出しわけを確認できます。` を `仮データで動作します。ロールや組織種別による画面の出しわけを確認できます。` にする

- [ ] **Step 4: 型を確認する**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: 変更を確認する（コミットしない）**

Run: `git status --short app`

---

### Task 4: `isMock` の置き換えとビルド時フラグの削除

**Files:**
- Modify（機械的な置き換え）: `app/composables/` の `useAdminNav.ts` `useCurrentOrg.ts` `useGbpPosts.ts` `useGbpProfiles.ts` `useGbpReviews.ts` `useGoogleConnection.ts` `useInvitation.ts` `useMembers.ts` `usePublicSurvey.ts` `useRankHistory.ts` `useRankKeywords.ts` `useRankSearch.ts` `useReplyTemplates.ts` `useResponses.ts` `useReviewDraft.ts` `useStores.ts` `useSurveyEditor.ts` `useSurveyPublish.ts` `useSurveys.ts`
- Modify: `app/middleware/org-ready.global.ts`
- Modify: `app/layouts/auth.vue`、`app/pages/index.vue`、`app/pages/admin/[orgId]/settings/google.vue`
- Modify: `nuxt.config.ts`

**Interfaces:**
- Consumes: `useDemoSession()`（Task 2）

- [ ] **Step 1: composables の機械的な置き換え**

上の 19 ファイルそれぞれで:
1. `const isMock = useRuntimeConfig().public.useMock` を `const { isMock } = useDemoSession()` にする
2. それ以外の `isMock` の参照をすべて `isMock.value` にする（`!isMock` → `!isMock.value`、`isMock ?` → `isMock.value ?`、`ref(!isMock)` → `ref(!isMock.value)`）

次の 2 か所は、値を一度だけ作っているので computed にする:

`app/composables/useResponses.ts`:

```ts
  /** Firebase 側は購読の範囲（直近 90 日・2,000 件）だけを表示している */
  const isWindowed = computed(() => !isMock.value)
```

`app/composables/useSurveys.ts`:

```ts
  const responseCountNote = computed(() => (isMock.value ? '' : '直近 90 日'))
```

（どちらも戻り値をページで分割代入してテンプレートでだけ使っているので、テンプレート側の変更は不要。`grep -rn "isWindowed\|responseCountNote" app` で `<script>` 内の参照が無いことを確認する。あれば `.value` を付ける）

`app/composables/usePublicSurvey.ts` と `app/composables/useInvitation.ts` は、呼んだ時点の `isMock.value` で読み込みを始めるかを決めている。ページを開くたびに呼ばれ、ページ内でモードは変わらないので、置き換えだけでよい。`usePublicSurvey.ts` の `const isLoading = ref(!isMock.value)` の直前に次のコメントを足す:

```ts
  // ページを開くたびに呼ばれ、ページ内でモードは変わらないため、読み込みの要否は呼んだ時点で決める
```

- [ ] **Step 2: ミドルウェア**

`app/middleware/org-ready.global.ts`:
- 1 行目のコメント `// 本物モードでまだ Firebase に接続していない管理画面は、準備中ページへ移す。` を `// デモ以外（Firebase）でまだ接続していない管理画面は、準備中ページへ移す。` にする
- `if (useRuntimeConfig().public.useMock || !to.path.startsWith('/admin/')) return` を `if (useDemoSession().isMock.value || !to.path.startsWith('/admin/')) return` にする

- [ ] **Step 3: 画面**

`app/layouts/auth.vue`:
- `const isMock = useRuntimeConfig().public.useMock` を `const { isMock } = useDemoSession()` にする
- 文言 `デモ版: Firebase 未接続のため仮データで動作しています` を `デモアカウントでログイン中のため、仮データで動作しています` にする（`v-if="isMock"` はそのまま）

`app/pages/index.vue`:
- `const isMock = useRuntimeConfig().public.useMock` を `const { isMock } = useDemoSession()` にする
- 説明文の `<p v-if="isMock" …>` の `v-if="isMock"` を外し、文言を `デモアカウントでログインすると、仮の固定データで動作します。ページを再読み込みすると操作内容は初期状態に戻ります。` にする
- 「回答画面のデモ」の `<section class="space-y-3">` に `v-if="isMock"` を付ける

`app/pages/admin/[orgId]/settings/google.vue`:
- `const isMock = useRuntimeConfig().public.useMock` を `const { isMock } = useDemoSession()` にする（`<script>` 内に他の `isMock` 参照があれば `.value` にする。テンプレートの `v-if="isMock"` はそのまま）

- [ ] **Step 4: ビルド時フラグを消す**

`nuxt.config.ts` の `runtimeConfig.public` から次の 4 行（コメント 2 行と値 2 行）を削除する:

```ts
      // false で Firebase に本接続する（既定はモック）。対象は認証・組織・メンバー（docs/superpowers/specs/2026-10-07-gbp-integration-design.md 3.1）
      useMock: process.env.NUXT_PUBLIC_USE_MOCK !== 'false',
      // true でクライアントを Firebase Emulator に接続する
      useEmulator: process.env.NUXT_PUBLIC_USE_EMULATOR === 'true',
```

- [ ] **Step 5: 取り残しがないことを確認する**

Run: `grep -rn "public.useMock\|useEmulator\|NUXT_PUBLIC_USE" app nuxt.config.ts`
Expected: 出力なし

Run: `grep -rn "isMock" app --include=*.ts | grep -v "isMock.value\|const { isMock\|isMock = computed\|isMock, \|{ demoUid, isMock"`
Expected: 出力なし（`.ts` の中で `.value` なしの参照が残っていない）

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: 変更を確認する（コミットしない）**

Run: `git status --short app nuxt.config.ts`

---

### Task 5: 起動スクリプトの削除とドキュメント

**Files:**
- Delete: `scripts/dev-emulator.sh`（`scripts/` に他のファイルがあればフォルダは残す）
- Modify: `package.json`（`dev:emulator` / `dev:firebase` / `generate:firebase` を削除）
- Create: `functions/.env.local`（追跡外。Functions Emulator だけが読む）
- Modify: `.claude/PROJECT.md`（「モード」「Secret（Emulator 用の値）」「npm scripts」「Emulator」の記述）

- [ ] **Step 1: スクリプトを削除し、環境変数を `functions/.env.local` に移す**

Run: `rm scripts/dev-emulator.sh`

Run: `git check-ignore -v functions/.env.local`
Expected: `functions/.gitignore` の `*.local` で無視されると表示される（表示されなければ止まって報告する）

`functions/.env.local` を作る（すでにあれば、同じキーが無いことを確認して末尾に足す。中身は表示しない）:

```dotenv
# Functions Emulator だけが読む（デプロイされない）。手元で Functions を動かすときの値
# googleOAuthCallback が使う URL（Emulator 用）
OAUTH_CALLBACK_URL=http://127.0.0.1:5001/meo-tool-d98e5/asia-northeast1/googleOAuthCallback
ADMIN_APP_URL=http://localhost:3000
# 順位計測（rankCheckWorker）は @sparticuz/chromium の Linux 用 Chromium を使うため Mac では起動できない（spawn ENOEXEC）。手元の Chrome を使う
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

- [ ] **Step 2: `package.json`**

`scripts` から次の 3 行を削除する:

```json
    "dev:emulator": "bash scripts/dev-emulator.sh",
```

```json
    "dev:firebase": "NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=false nuxt dev",
```

```json
    "generate:firebase": "NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=false nuxt generate",
```

- [ ] **Step 3: `.claude/PROJECT.md`**

「## モード（モック / 本接続）」の見出しから、`- 本接続済みの画面は …` の行の直前までを次に置き換える（`- 本接続済みの画面は` 以降の箇条書きは残す。ただし「本物モード」という語は「Firebase 側」に直す）:

```markdown
## モード（デモ / 本接続）

- 画面は**常に本番の Firebase**（meo-tool-d98e5）の Auth / Firestore / Storage / Functions に接続する（ビルド時の切り替えはない）
- **デモアカウント 3 人**（`app/utils/mock/seed.ts` の `DEMO_ACCOUNTS`：`u-kobayashi` / `u-tanaka` / `u-sato`）でログインしている間だけ、画面を `app/utils/mock/` の仮データで動かす。判定は `useDemoSession()` の `isMock`
  - ログイン画面のボタン、または 3 人のメールアドレス + `DEMO_PASSWORD`（`password`）でデモに入る。それ以外は Firebase Auth で認証する
  - デモに入ると Firebase からログアウトし、Firebase でログインするとデモを抜ける（同時に有効にしない）。状態は localStorage `meo-tool:mock-uid`
  - 仮データ内のそれ以外のユーザー（運営の `u-ops` など）ではログインできない。運営画面の本接続は未着手
- 画面を `localhost` / `127.0.0.1` で開いたときだけ、Functions を手元の Emulator（`127.0.0.1:5001`）に向ける（`app/plugins/firebase.client.ts`）。Emulator を起動していないと Functions を呼ぶ操作は失敗する
- Functions の「ローカル用の値」（ローカル暗号・固定の IP ソルト）は、Functions と Firestore の両方が Emulator のとき（`functions/src/shared/emulator.ts` の `isFullyEmulated`）だけ使う。Functions だけの Emulator は本番データを触るため使わない
```

「Secret」節の `- Emulator 用の値は scripts/dev-emulator.sh …` の行を `- Emulator 用の値（\`OAUTH_CALLBACK_URL\` / \`ADMIN_APP_URL\` / \`CHROME_PATH\`）は \`functions/.env.local\`（追跡外。Functions Emulator だけが読む）に置く` に置き換え、その後ろに次の行を足す:

```markdown
- 手元の Functions Emulator は本番の Firestore / Auth / KMS に触れる。事前に `gcloud auth application-default login` を実行し、本番と同じ Secret（`KMS_KEY_NAME` / `IP_HASH_SALT` など）を `functions/.secret.local` か環境変数で渡す（未設定だと Google 連携・アンケート回答はエラーになる）
```

`SECRET_CIPHER` の行の説明 `（本番では設定しない。Functions Emulator では自動でローカル暗号）` を `（本番では設定しない。Functions と Firestore の両方が Emulator のときは自動でローカル暗号）` にし、`IP_HASH_SALT` の行の `Emulator では未設定なら固定値` を `Functions と Firestore の両方が Emulator なら未設定でも固定値` にする。

「## npm scripts」の表で:
- `npm run dev` の行を `| ルート | \`npm run dev\` | 開発サーバー（本番の Firebase に接続。localhost で開くので Functions は 127.0.0.1:5001 に向く。Functions を呼ぶ操作には別のターミナルで \`npm --prefix functions run serve\` を起動しておく。デモアカウントの確認だけなら不要） |` にする
- `npm run dev:emulator` の行を削除する
- `functions` の `npm run serve` の行を表に足す: `| functions | \`npm run serve\` | Functions をビルドして Functions Emulator（127.0.0.1:5001）だけを起動する。Auth / Firestore / Storage は本番のため、操作は本番のデータとして残る。値は \`functions/.env.local\` から読む。定期実行（\`scheduledRankCheck\` など）は発火しない |`
- `dev:firebase` と `generate:firebase` の行を削除する
- `npm run generate` の行を `| ルート | \`npm run generate\` | 静的生成（Hosting にデプロイする本番用。デモ判定は実行時なので 1 種類） |` にする

表の後ろの段落を次に置き換える（`Emulator は **Java 21 以上**が必要…` から `Emulator のデータは Firebase コンソールには出ない（Emulator UI で確認する）。` まで）:

```markdown
`npm run test:emulator` の Firestore / Storage Emulator は **Java 21 以上**が必要（このマシンでは Homebrew の `openjdk@21`。keg-only のため `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` を付けて実行する）。`functions` の `npm run serve` は Functions だけなので Java は不要。
`.emulator-data/` は以前の全 Emulator 構成の保存先で、今は使わない（`.gitignore` には残す）。
```

84 行目付近の `- Emulator（Functions）では Cloud Tasks のキューが動く（2026-10-08 に確認）。…` は事実として残す。

- [ ] **Step 4: 確認**

Run: `grep -rn "dev:firebase\|generate:firebase\|NUXT_PUBLIC_USE" package.json .claude/PROJECT.md`
Expected: 出力なし

Run: `grep -rn "dev:emulator\|dev-emulator" package.json .claude/PROJECT.md`
Expected: 出力なし

- [ ] **Step 5: 変更を確認する（コミットしない）**

Run: `git status --short`

---

### Task 6: 通しの確認（コントローラーが行う）

- [ ] **Step 1: 自動の確認**

Run: `npm --prefix functions test` → fail 0
Run: `npm --prefix functions run build` → エラーなし
Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator` → fail 0
Run: `npm run typecheck` → exit 0
Run: `npm run generate` → 成功。`grep -o 'useMock[^,]*' .output/public/index.html` が出力なし

- [ ] **Step 2: 画面の確認（Playwright、`npm run dev` で起動）**

Functions を呼ばない範囲で確認する（本番データを作らない）:
1. `/login` にデモボタン 3 つとパスワードの案内が出る
2. 「個人 / オーナー」ボタン → `/orgs` → 管理画面に仮データ（カフェ こもれび）が出る。auth レイアウトにデモ中の表示が出る
3. 再読み込み → デモのまま管理画面が出る（Review Focus 1）
4. ログアウト → `/login`。`kobayashi@example.com` + `password` でメールログイン → デモに入る
5. ログアウト → `ops@example.com` + `password` → Firebase Auth のエラー表示（デモに入らない）
6. localStorage に `meo-tool:mock-uid = u-ops` を入れて再読み込み → `/ops` が 404・未ログイン扱い（Review Focus 3）
7. `/` でログアウト中は「回答画面のデモ」が出ず、デモ中は出て `/s/k7m2q9x4pa` が仮データで開く
8. コンソールに `Failed to resolve component` やエラーが出ていない

本物のアカウントでの確認（本番ログイン中にデモボタン、Review Focus 2）は、本番にテスト用アカウントを作ることになるため、ユーザーに確認してから行う。
