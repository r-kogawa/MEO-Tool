import { getAuth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import { appUrl } from '../shared/appUrl'
import { fail } from '../shared/errors'
import { asObject, requireEmail } from '../shared/validation'
import { createOrganization, parseCreateOrganizationInput } from './createOrganization'

// 外部システムからのアカウント作成。画面の新規登録（F-01）と同じく、Auth ユーザー・組織・owner メンバーを作る。
// パスワードは設定せず、パスワード設定リンクを返す（利用者へのメール送信は呼び出し元が行う）。
// リンクは Firebase の既定の画面ではなく、管理画面のパスワード設定ページ（/password-setup?oobCode=...）を指す

/** Auth の uid・組織 ID を画面の新規登録と分けるための接頭辞 */
const EXTERNAL_PREFIX = 'ext-'
/** uid は 128 文字まで（接頭辞の分を引く） */
const MAX_REQUEST_ID_LENGTH = 100

/** Firebase Auth の操作。テストで差し替える */
export interface AccountAuth {
  /** uid のユーザーのメールアドレス。ユーザーがいなければ null */
  getUserEmail(uid: string): Promise<string | null>
  /** パスワードなしのユーザーを作る。メールアドレスか uid が使用済みならその旨を返す */
  createUser(uid: string, email: string, displayName: string): Promise<'created' | 'email-exists' | 'uid-exists'>
  createPasswordSetupLink(email: string): Promise<string>
}

export interface CreateAccountResult {
  uid: string
  orgId: string
  passwordSetupLink: string
}

const errorCodeOf = (error: unknown) => (error as { code?: unknown }).code

/** Firebase が作ったパスワード再設定リンクから oobCode を取り出し、管理画面のパスワード設定ページの URL にする */
export function toPasswordSetupUrl(firebaseLink: string): string {
  const oobCode = new URL(firebaseLink).searchParams.get('oobCode')
  if (!oobCode) throw new Error('パスワード再設定リンクに oobCode がありません。')
  return appUrl(`/password-setup?oobCode=${encodeURIComponent(oobCode)}`)
}

export const defaultAccountAuth: AccountAuth = {
  async getUserEmail(uid) {
    try {
      return (await getAuth().getUser(uid)).email?.toLowerCase() ?? ''
    }
    catch (error) {
      if (errorCodeOf(error) === 'auth/user-not-found') return null
      throw error
    }
  },
  async createUser(uid, email, displayName) {
    try {
      await getAuth().createUser({ uid, email, displayName, emailVerified: false })
      return 'created'
    }
    catch (error) {
      if (errorCodeOf(error) === 'auth/email-already-exists') return 'email-exists'
      if (errorCodeOf(error) === 'auth/uid-already-exists') return 'uid-exists'
      throw error
    }
  },
  async createPasswordSetupLink(email) {
    return toPasswordSetupUrl(await getAuth().generatePasswordResetLink(email))
  },
}

/**
 * Auth ユーザーと組織を作る。uid・組織 ID を requestId から決めるため、同じリクエストの再送は同じ結果を返す。
 * 途中で失敗した場合（Auth ユーザーだけできた状態）も、同じ requestId で再送すれば続きから作る。
 */
export async function createAccountFunc(db: Firestore, data: unknown, auth: AccountAuth = defaultAccountAuth): Promise<CreateAccountResult> {
  const input = parseCreateOrganizationInput(data)
  const email = requireEmail(asObject(data).email)
  if (input.requestId.length > MAX_REQUEST_ID_LENGTH) fail('invalid-argument', `リクエスト ID は ${MAX_REQUEST_ID_LENGTH} 文字以内にしてください。`)
  const uid = `${EXTERNAL_PREFIX}${input.requestId}`

  if ((await auth.getUserEmail(uid)) === null) {
    const created = await auth.createUser(uid, email, input.displayName)
    if (created === 'email-exists') fail('already-exists', 'このメールアドレスはすでに登録されています。')
  }
  // 再送（または同時に届いた同じリクエスト）のときは、同じメールアドレスへの依頼かを確かめる
  if ((await auth.getUserEmail(uid)) !== email) fail('already-exists', 'このリクエスト ID は別のメールアドレスで使用済みです。')

  const { orgId } = await createOrganization(
    db,
    { uid, email, isEmailVerified: false },
    { ...input, requestId: `${EXTERNAL_PREFIX}${input.requestId}` },
  )
  return { uid, orgId, passwordSetupLink: await auth.createPasswordSetupLink(email) }
}
