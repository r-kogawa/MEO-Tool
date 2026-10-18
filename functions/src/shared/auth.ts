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
