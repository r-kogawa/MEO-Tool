import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvitationMail } from '../invitationMail'

test('buildInvitationMail: 組織名・権限・有効期限（日本時間）・URL を入れる', () => {
  const mail = buildInvitationMail({
    to: 'new@example.com',
    orgName: '株式会社ハナミ食堂',
    role: 'staff',
    url: 'https://app.example.com/invite/abc',
    expiresAt: new Date('2026-10-16T03:00:00Z'),
  })

  assert.equal(mail.to, 'new@example.com')
  assert.equal(mail.subject, '【MFF MEOツール】株式会社ハナミ食堂 からの招待')
  assert.ok(mail.text.includes('権限: スタッフ'))
  assert.ok(mail.text.includes('2026/10/16 12:00'))
  assert.ok(mail.text.includes('https://app.example.com/invite/abc'))
})
