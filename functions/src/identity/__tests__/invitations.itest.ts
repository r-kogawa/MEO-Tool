import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import type { Mailer, MailMessage } from '../../shared/mail'
import {
  createInvitationFunc,
  getInvitationFunc,
  hashToken,
  updateInvitationAcceptFunc,
  updateInvitationRevokeFunc,
} from '../invitations'

const db = getTestDb()
const OWNER = caller('u-owner')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
  await seedOrg(db, { orgId: 'org-solo', type: 'individual', members: [{ uid: 'u-solo', role: 'owner' }] })
})

async function expireInvitation(orgId: string, invitationId: string) {
  await db.doc(`organizations/${orgId}/invitations/${invitationId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
}

test('createInvitation: 平文トークンを返し、保存はハッシュのみ', async () => {
  const invitation = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: ' New@Example.com ', role: 'staff', storeIds: ['st-1'] })

  assert.equal(invitation.email, 'new@example.com')
  assert.equal(invitation.status, 'pending')
  assert.ok(invitation.token.length >= 32)
  const saved = (await db.doc(`organizations/org-a/invitations/${invitation.id}`).get()).data()!
  assert.equal(saved.tokenHash, hashToken(invitation.token))
  assert.equal(saved.token, undefined)
  assert.ok(Date.parse(invitation.expiresAt) > Date.now() + 6 * 24 * 3600 * 1000)
})

test('createInvitation: 招待した人に招待 URL 入りのメールを送る', async () => {
  process.env.ADMIN_APP_URL = 'https://app.example.com'
  const sent: MailMessage[] = []
  const mailer: Mailer = { async send(message) { sent.push(message) } }

  const invitation = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] }, mailer)

  assert.equal(invitation.isMailSent, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.to, 'new@example.com')
  assert.ok(sent[0]!.text.includes(`https://app.example.com/invite/${invitation.token}`))
})

test('createInvitation: メールを送れなくても招待は作成し、isMailSent: false を返す', async () => {
  const mailer: Mailer = { async send() { throw new Error('SMTP 接続失敗') } }

  const invitation = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] }, mailer)

  assert.equal(invitation.isMailSent, false)
  assert.ok((await db.doc(`organizations/org-a/invitations/${invitation.id}`).get()).exists)
})

test('createInvitation: staff・個人組織・既存メンバー・送信済みは拒否', async () => {
  await assert.rejects(
    createInvitationFunc(db, caller('u-staff'), { orgId: 'org-a', email: 'x@example.com', role: 'admin', storeIds: [] }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    createInvitationFunc(db, caller('u-solo'), { orgId: 'org-solo', email: 'x@example.com', role: 'admin', storeIds: [] }),
    { code: 'failed-precondition', message: 'メンバー招待は法人組織のみ利用できます。' },
  )
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'U-STAFF@example.com', role: 'admin', storeIds: [] }),
    { code: 'already-exists', message: 'すでにメンバーです。' },
  )
  await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'X@example.com', role: 'admin', storeIds: [] }),
    { code: 'already-exists', message: 'このメールアドレスには招待を送信済みです。' },
  )
})

test('createInvitation: staff は担当店舗が必須で、存在しない店舗は拒否', async () => {
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'staff', storeIds: [] }),
    { code: 'invalid-argument', message: 'スタッフには担当店舗を 1 つ以上選んでください。' },
  )
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'x@example.com', role: 'staff', storeIds: ['st-none'] }),
    { code: 'invalid-argument', message: '担当店舗に存在しない店舗が含まれています。' },
  )
})

test('createInvitation: メンバー + 有効な招待が上限に達したら resource-exhausted（期限切れは数えない）', async () => {
  await db.doc('organizations/org-a').update({ 'limits.maxMembers': 3 })
  const expired = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'old@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', expired.id)
  // メンバー 2 + 有効な招待 0 → 3 人目の招待は可能
  await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'a@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'b@example.com', role: 'admin', storeIds: [] }),
    { code: 'resource-exhausted', message: 'メンバー数の上限（3 名）に達しています。' },
  )
})

test('getInvitation: トークンで招待・組織名・店舗名を返す（トークンは返さない）', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'staff', storeIds: ['st-1'] })

  const result = await getInvitationFunc(db, { token: created.token })

  assert.equal(result.invitation.id, created.id)
  assert.equal(result.invitation.token, '')
  assert.equal(result.org.name, '組織 org-a')
  assert.deepEqual(result.storeNames, ['渋谷店'])
})

test('getInvitation: 不明なトークンは not-found、期限切れは status=expired', async () => {
  await assert.rejects(getInvitationFunc(db, { token: 'unknown-token' }), { code: 'not-found', message: '招待が見つかりません。URL をご確認ください。' })
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', created.id)
  const result = await getInvitationFunc(db, { token: created.token })
  assert.equal(result.invitation.status, 'expired')
})

test('acceptInvitation: メールが一致すればメンバーになり、招待は accepted', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'New@Example.com', role: 'staff', storeIds: ['st-1'] })

  const { orgId } = await updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' })

  assert.equal(orgId, 'org-a')
  const member = (await db.doc('organizations/org-a/members/u-new').get()).data()!
  assert.equal(member.role, 'staff')
  assert.deepEqual(member.storeIds, ['st-1'])
  assert.equal(member.displayName, '新人')
  assert.equal(member.orgId, 'org-a')
  const invitation = (await db.doc(`organizations/org-a/invitations/${created.id}`).get()).data()!
  assert.equal(invitation.status, 'accepted')
  assert.equal((await db.doc('users/u-new').get()).get('lastOrgId'), 'org-a')
})

test('acceptInvitation: メール不一致・受諾済み・期限切れ・既存メンバーは拒否', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-x', 'other@example.com'), { token: created.token, displayName: 'X' }),
    { code: 'permission-denied', message: '招待されたメールアドレス（new@example.com）でログインしてください。' },
  )
  await updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com'), { token: created.token, displayName: '新人' }),
    { code: 'failed-precondition', message: 'この招待は無効です（期限切れ・取消済み・受諾済み）。' },
  )

  const expired = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'late@example.com', role: 'admin', storeIds: [] })
  await expireInvitation('org-a', expired.id)
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-late', 'late@example.com'), { token: expired.token, displayName: 'L' }),
    { code: 'failed-precondition' },
  )

  const dup = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'dup@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-staff', 'dup@example.com'), { token: dup.token, displayName: 'D' }),
    { code: 'already-exists', message: 'すでにこの組織のメンバーです。' },
  )
})

test('revokeInvitation: owner / admin が pending を取り消せる。取消済み・staff は拒否', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })
  await assert.rejects(
    updateInvitationRevokeFunc(db, caller('u-staff'), { orgId: 'org-a', invitationId: created.id }),
    { code: 'permission-denied' },
  )

  await updateInvitationRevokeFunc(db, OWNER, { orgId: 'org-a', invitationId: created.id })

  assert.equal((await db.doc(`organizations/org-a/invitations/${created.id}`).get()).get('status'), 'revoked')
  await assert.rejects(
    updateInvitationRevokeFunc(db, OWNER, { orgId: 'org-a', invitationId: created.id }),
    { code: 'not-found', message: '取り消せる招待がありません。' },
  )
})

test('acceptInvitation: メールアドレスが未確認のアカウントは受諾できない（URL の転送によるなりすまし対策）', async () => {
  const created = await createInvitationFunc(db, OWNER, { orgId: 'org-a', email: 'new@example.com', role: 'admin', storeIds: [] })

  await assert.rejects(
    updateInvitationAcceptFunc(db, caller('u-new', 'new@example.com', false), { token: created.token, displayName: '新人' }),
    { code: 'failed-precondition', message: 'メールアドレスの確認が完了していません。確認メールのリンクを開いてから、もう一度お試しください。' },
  )
  assert.equal((await db.doc('organizations/org-a/members/u-new').get()).exists, false)
})
