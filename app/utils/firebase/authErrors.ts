import { FirebaseError } from 'firebase/app'

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。',
  'auth/weak-password': 'パスワードは 8 文字以上にしてください。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてから再度お試しください。',
  'auth/expired-action-code': 'リンクの有効期限が切れています。パスワード再設定から新しいリンクを発行してください。',
  'auth/invalid-action-code': 'リンクが無効です（使用済み、または URL が途中で切れている可能性があります）。パスワード再設定から新しいリンクを発行してください。',
  'auth/network-request-failed': '通信に失敗しました。接続を確認して再度お試しください。',
}

/** Firebase Auth のエラーを画面表示用の Error にする */
export function toAuthError(error: unknown): Error {
  const message = error instanceof FirebaseError ? MESSAGES[error.code] : undefined
  return new Error(message ?? '認証に失敗しました。時間をおいて再度お試しください。', { cause: error })
}
