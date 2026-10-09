import { FirebaseError } from 'firebase/app'
import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyPasswordResetCode,
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

  /** パスワード設定リンクの oobCode を確かめ、対象のメールアドレスを返す */
  async function verifyPasswordSetupCode(oobCode: string): Promise<string> {
    try {
      return await verifyPasswordResetCode($auth, oobCode)
    }
    catch (error) {
      throw toAuthError(error)
    }
  }

  /** oobCode でパスワードを設定し、そのままログインする */
  async function setupPassword(oobCode: string, email: string, password: string): Promise<void> {
    validatePassword(password)
    try {
      await confirmPasswordReset($auth, oobCode, password)
    }
    catch (error) {
      throw toAuthError(error)
    }
    await login(email, password)
  }

  return { user, isLoggedIn, login, logout, verifyPasswordSetupCode, setupPassword, signup, registerUser, requestPasswordReset }
}
