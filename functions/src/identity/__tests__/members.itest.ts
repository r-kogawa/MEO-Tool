import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { deleteMemberFunc, updateMemberRoleFunc, updateOrganizationNameFunc } from '../members'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [
      { uid: 'u-owner', role: 'owner' },
      { uid: 'u-admin', role: 'admin' },
      { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] },
    ],
  })
})

test('updateMemberRole: admin を staff にすると担当店舗を保存し、admin にすると空にする', async () => {
  await updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: ['st-2'] })
  assert.deepEqual((await db.doc('organizations/org-a/members/u-admin').get()).get('storeIds'), ['st-2'])

  await updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'admin', storeIds: ['st-2'] })
  const admin = (await db.doc('organizations/org-a/members/u-admin').get()).data()!
  assert.equal(admin.role, 'admin')
  assert.deepEqual(admin.storeIds, [])
})

test('updateMemberRole: owner は変更不可、staff は実行不可、staff には担当店舗が必須', async () => {
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-owner', role: 'admin', storeIds: [] }),
    { code: 'failed-precondition', message: 'オーナーの権限は変更できません。' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-staff'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: ['st-1'] }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-admin', role: 'staff', storeIds: [] }),
    { code: 'invalid-argument', message: 'スタッフには担当店舗を 1 つ以上選んでください。' },
  )
  await assert.rejects(
    updateMemberRoleFunc(db, caller('u-owner'), { orgId: 'org-a', targetUid: 'u-none', role: 'admin', storeIds: [] }),
    { code: 'not-found', message: 'メンバーが見つかりません。' },
  )
})

test('deleteMember: メンバーを削除する。owner・自分自身は削除不可', async () => {
  await deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-staff' })
  assert.equal((await db.doc('organizations/org-a/members/u-staff').get()).exists, false)

  await assert.rejects(
    deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-owner' }),
    { code: 'failed-precondition', message: 'オーナーは削除できません。' },
  )
  await assert.rejects(
    deleteMemberFunc(db, caller('u-admin'), { orgId: 'org-a', targetUid: 'u-admin' }),
    { code: 'failed-precondition', message: '自分自身は削除できません。' },
  )
})

test('updateOrganizationName: owner のみ変更でき、空は拒否', async () => {
  await updateOrganizationNameFunc(db, caller('u-owner'), { orgId: 'org-a', name: ' 新しい名前 ' })
  assert.equal((await db.doc('organizations/org-a').get()).get('name'), '新しい名前')

  await assert.rejects(updateOrganizationNameFunc(db, caller('u-admin'), { orgId: 'org-a', name: 'x' }), { code: 'permission-denied' })
  await assert.rejects(
    updateOrganizationNameFunc(db, caller('u-owner'), { orgId: 'org-a', name: '  ' }),
    { code: 'invalid-argument', message: '組織名を入力してください。' },
  )
})
