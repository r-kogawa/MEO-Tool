import type { MailMessage } from '../shared/mail'

const ROLE_LABELS = { admin: '管理者', staff: 'スタッフ' } as const

interface InvitationMailInput {
  to: string
  orgName: string
  role: keyof typeof ROLE_LABELS
  url: string
  expiresAt: Date
}

/** 招待メールの件名と本文 */
export function buildInvitationMail({ to, orgName, role, url, expiresAt }: InvitationMailInput): MailMessage {
  const expires = expiresAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' })
  return {
    to,
    subject: `【MFF MEOツール】${orgName} からの招待`,
    text: [
      `${orgName} から MFF MEOツール への招待が届きました。`,
      '',
      `権限: ${ROLE_LABELS[role]}`,
      `有効期限: ${expires}`,
      '',
      '下の URL を開いて、参加の手続きをしてください。',
      url,
      '',
      'お心当たりのない場合は、このメールを破棄してください。',
    ].join('\n'),
  }
}
