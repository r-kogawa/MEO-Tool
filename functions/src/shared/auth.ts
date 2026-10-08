import type { CallableRequest } from 'firebase-functions/https'
import { fail } from './errors'

export interface Caller {
  uid: string
  /** 小文字化済み。メール未設定のアカウントは空文字 */
  email: string
  /** メールアドレスの所有を確認済みか。メールアドレスで権限を判定するとき（招待の受諾）は必須にする */
  isEmailVerified: boolean
}

export function requireCaller(request: CallableRequest<unknown>): Caller {
  const auth = request.auth
  if (!auth) fail('unauthenticated', 'ログインしてください。')
  const email = typeof auth.token.email === 'string' ? auth.token.email.toLowerCase() : ''
  return { uid: auth.uid, email, isEmailVerified: auth.token.email_verified === true }
}
