import nodemailer from 'nodemailer'

// SMTP（Xserver）でメールを送る。接続先・認証は環境変数 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / MAIL_FROM

export interface MailMessage {
  to: string
  subject: string
  text: string
}

/** メール送信。テストで差し替える */
export interface Mailer {
  send(message: MailMessage): Promise<void>
}

export const smtpMailer: Mailer = {
  async send(message) {
    const host = process.env.SMTP_HOST
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASSWORD
    if (!host || !user || !pass) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASSWORD が未設定です。')
    // 465 は SSL/TLS、587 は STARTTLS（Xserver はどちらも可）
    const port = Number(process.env.SMTP_PORT || 465)
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await transport.sendMail({ from: process.env.MAIL_FROM || user, ...message })
  },
}
