import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb } from '../../__tests__/emulator'
import { createOrganizationFunc } from '../createOrganization'

const db = getTestDb()
const input = { requestId: 'req12345678', type: 'corporate', orgName: ' ハナミ食堂 ', displayName: '田中' }

beforeEach(() => clearFirestore())

test('組織・owner メンバー・ユーザーを作成する', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1', 'tanaka@example.com'), input)

  assert.equal(orgId, 'org-req12345678')
  const org = (await db.doc(`organizations/${orgId}`).get()).data()!
  assert.equal(org.name, 'ハナミ食堂')
  assert.equal(org.type, 'corporate')
  assert.equal(org.plan, 'ビジネス')
  assert.equal(org.status, 'active')
  assert.equal(org.ownerUid, 'u-1')
  assert.equal(org.limits.maxMembers, 20)

  const member = (await db.doc(`organizations/${orgId}/members/u-1`).get()).data()!
  assert.equal(member.role, 'owner')
  assert.equal(member.orgId, orgId)
  assert.equal(member.uid, 'u-1')
  assert.equal(member.email, 'tanaka@example.com')
  assert.equal(member.displayName, '田中')

  const user = (await db.doc('users/u-1').get()).data()!
  assert.equal(user.lastOrgId, orgId)
  assert.equal(user.platformRole, null)

  const logs = await db.collection(`organizations/${orgId}/auditLogs`).get()
  assert.equal(logs.size, 1)
  assert.equal(logs.docs[0].get('action'), 'organization.create')
})

test('個人組織はライトプラン・メンバー上限 1', async () => {
  const { orgId } = await createOrganizationFunc(db, caller('u-1'), { ...input, type: 'individual' })
  const org = (await db.doc(`organizations/${orgId}`).get()).data()!
  assert.equal(org.plan, 'ライト')
  assert.equal(org.limits.maxMembers, 1)
})

test('同じ requestId の再送は同じ組織を返し、重複作成しない', async () => {
  const first = await createOrganizationFunc(db, caller('u-1'), input)
  const second = await createOrganizationFunc(db, caller('u-1'), input)

  assert.equal(second.orgId, first.orgId)
  const orgs = await db.collection('organizations').where('ownerUid', '==', 'u-1').get()
  assert.equal(orgs.size, 1)
  const logs = await db.collection(`organizations/${first.orgId}/auditLogs`).get()
  assert.equal(logs.size, 1)
})

test('別ユーザーが同じ requestId を使うと already-exists', async () => {
  await createOrganizationFunc(db, caller('u-1'), input)
  await assert.rejects(createOrganizationFunc(db, caller('u-2'), input), { code: 'already-exists' })
})

test('入力不正は invalid-argument', async () => {
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, type: 'company' }), { code: 'invalid-argument' })
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, orgName: '' }), { code: 'invalid-argument', message: '組織名を入力してください。' })
  await assert.rejects(createOrganizationFunc(db, caller('u-1'), { ...input, requestId: 'a/b' }), { code: 'invalid-argument' })
})

test('既存ユーザーの platformRole（運営フラグ）は上書きしない', async () => {
  await db.doc('users/u-ops').set({ email: 'ops@example.com', displayName: '運営', platformRole: 'operator' })

  await createOrganizationFunc(db, caller('u-ops', 'ops@example.com'), input)

  assert.equal((await db.doc('users/u-ops').get()).get('platformRole'), 'operator')
})
