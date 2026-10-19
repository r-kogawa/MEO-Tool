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
