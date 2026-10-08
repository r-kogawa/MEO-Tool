import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { requireMember, requireOrg, requireStoreAccess } from '../members'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-owner', role: 'owner' }] })
})

test('requireOrg: 有効な組織を返す', async () => {
  const org = await requireOrg(db, 'org-a')
  assert.equal(org.type, 'corporate')
})

test('requireOrg: 存在しなければ not-found、停止中なら failed-precondition', async () => {
  await assert.rejects(requireOrg(db, 'org-none'), { code: 'not-found', message: '組織が見つかりません。' })
  await assert.rejects(requireOrg(db, 'org-stop'), { code: 'failed-precondition', message: 'この組織は利用停止中です。' })
})

test('requireMember: メンバーでなければ permission-denied', async () => {
  await assert.rejects(requireMember(db, 'org-a', 'u-other'), { code: 'permission-denied', message: 'この組織のメンバーではありません。' })
})

test('requireMember: ロール指定に合わなければ permission-denied', async () => {
  const owner = await requireMember(db, 'org-a', 'u-owner', ['owner', 'admin'])
  assert.equal(owner.role, 'owner')
  await assert.rejects(requireMember(db, 'org-a', 'u-staff', ['owner', 'admin']), { code: 'permission-denied', message: 'この操作の権限がありません。' })
})

test('requireMember: トランザクション内でも読める', async () => {
  const member = await db.runTransaction(tx => requireMember(db, 'org-a', 'u-staff', undefined, tx))
  assert.deepEqual(member.storeIds, ['st-1'])
})

test('requireStoreAccess: staff は担当店舗のみ、owner は全店舗', async () => {
  const staff = await requireMember(db, 'org-a', 'u-staff')
  const owner = await requireMember(db, 'org-a', 'u-owner')
  requireStoreAccess(staff, 'st-1')
  requireStoreAccess(owner, 'st-9')
  assert.throws(() => requireStoreAccess(staff, 'st-2'), { code: 'permission-denied', message: '担当外の店舗です。' })
})
