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
import { createOrganizationFunc } from '~/utils/mock/functions/identity'
import { MockFunctionsError, mockLatency } from '~/utils/mock/functions/shared'
import { createId } from '~/utils/mock/random'
import { DEMO_PASSWORD } from '~/utils/mock/seed'

// F-01 認証。本物モードは Firebase Auth、モックは仮データのユーザーでログイン状態だけを再現する。

const STORAGE_KEY = 'meo-tool:mock-uid'

function readStoredUid(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
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
    // ストレージが使えない環境ではメモリ上のログイン状態だけで動かす
  }
}

interface SignupInput {
  type: OrgType
  orgName: string
  displayName: string
  email: string
  password: string
}


export function useAuth() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { $auth, $functions } = useNuxtApp()
  const { waitForOrg } = useBackendReady()
  const uid = useState<string | null>('auth-uid', () => (isMock ? readStoredUid() : null))
  // 組織作成の再送用。成功するまで同じ ID を使い、Functions 側の重複防止を効かせる
  const signupRequestId = useState('signup-request-id', () => crypto.randomUUID())

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
    // 登録有無が分からないよう、存在しないメールでも成功扱いにする
    void email
  }

  return { user, isLoggedIn, login, loginAs, logout, signup, registerUser, requestPasswordReset }
}
