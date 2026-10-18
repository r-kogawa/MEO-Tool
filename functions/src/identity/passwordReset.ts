import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions'
import { fail } from '../shared/errors'
import { smtpMailer, type Mailer, type MailMessage } from '../shared/mail'
import { asObject, requireEmail } from '../shared/validation'
import { toPasswordSetupUrl } from './createAccount'

// パスワード再設定（F-01）。外部アカウント作成と同じく、管理画面のパスワード設定ページ（/password-setup?oobCode=...）の
// リンクを作り、Firebase の既定のメールではなく SMTP（Xserver）で送る

/** パスワード設定ページのリンクを作る。テストで差し替える。アカウントがなければ null */
export type PasswordSetupLinkFactory = (email: string) => Promise<string | null>

export const defaultPasswordSetupLink: PasswordSetupLinkFactory = async (email) => {
  try {
    return toPasswordSetupUrl(await getAuth().generatePasswordResetLink(email))
  }
  catch (error) {
    if ((error as { code?: unknown }).code === 'auth/user-not-found') return null
    throw error
  }
}

/** パスワード再設定メールの件名と本文 */
export function buildPasswordResetMail(to: string, url: string): MailMessage {
  return {
    to,
    subject: '【MFF MEOツール】パスワード再設定のご案内',
    text: [
      'MFF MEOツール のパスワード再設定のお申し込みを受け付けました。',
      '',
      '下の URL を開いて、新しいパスワードを設定してください。',
      url,
      '',
      'お心当たりのない場合は、このメールを破棄してください。パスワードは変更されません。',
    ].join('\n'),
  }
}

/** 再設定メールを送る。登録の有無が分からないよう、アカウントがないメールアドレスでも成功扱いにする */
export async function postPasswordResetMailFunc(
  data: unknown,
  createLink: PasswordSetupLinkFactory = defaultPasswordSetupLink,
  mailer: Mailer = smtpMailer,
): Promise<void> {
  const email = requireEmail(asObject(data).email)
  const url = await createLink(email)
  if (!url) return
  try {
    await mailer.send(buildPasswordResetMail(email, url))
  }
  catch (error) {
    logger.error('パスワード再設定メールの送信に失敗', { error: String(error) })
    fail('unavailable', 'メールを送信できませんでした。しばらくしてから再度お試しください。')
  }
}
