import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mailer, MailMessage } from '../../shared/mail'
import { postPasswordResetMailFunc } from '../passwordReset'

const SETUP_URL = 'https://app.example.com/password-setup?oobCode=abc'

function recordingMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return { sent, async send(message) { sent.push(message) } }
}

test('postPasswordResetMail: 登録済みのメールアドレスにパスワード設定ページのリンクを送る', async () => {
  const mailer = recordingMailer()
  const requested: string[] = []

  await postPasswordResetMailFunc({ email: ' User@Example.com ' }, async (email) => {
    requested.push(email)
    return SETUP_URL
  }, mailer)

  assert.deepEqual(requested, ['user@example.com'])
  assert.equal(mailer.sent.length, 1)
  assert.equal(mailer.sent[0].to, 'user@example.com')
  assert.ok(mailer.sent[0].text.includes(SETUP_URL))
})

test('postPasswordResetMail: 未登録のメールアドレスでも成功扱いにし、メールは送らない', async () => {
  const mailer = recordingMailer()

  await postPasswordResetMailFunc({ email: 'none@example.com' }, async () => null, mailer)

  assert.equal(mailer.sent.length, 0)
})

test('postPasswordResetMail: メールの形式が正しくなければ invalid-argument', async () => {
  await assert.rejects(
    postPasswordResetMailFunc({ email: 'not-an-email' }, async () => SETUP_URL, recordingMailer()),
    { code: 'invalid-argument' },
  )
})

test('postPasswordResetMail: 送信に失敗したら unavailable', async () => {
  const failing: Mailer = { async send() { throw new Error('SMTP down') } }

  await assert.rejects(
    postPasswordResetMailFunc({ email: 'user@example.com' }, async () => SETUP_URL, failing),
    { code: 'unavailable', message: 'メールを送信できませんでした。しばらくしてから再度お試しください。' },
  )
})
