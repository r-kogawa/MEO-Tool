import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { memberRef, orgRef, requireMember, requireOrg, type MemberDoc } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString, requireStringArray } from '../shared/validation'

const ASSIGNABLE_ROLES = ['admin', 'staff'] as const

async function requireTarget(db: Firestore, orgId: string, uid: string, tx: Transaction): Promise<MemberDoc> {
  const snapshot = await tx.get(memberRef(db, orgId, uid))
  if (!snapshot.exists) fail('not-found', 'メンバーが見つかりません。')
  return snapshot.data() as MemberDoc
}

export async function updateMemberRoleFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const targetUid = requireId(input.targetUid, 'メンバー')
  const role = requireOneOf(input.role, ASSIGNABLE_ROLES, '権限')
  const storeIds = role === 'staff' ? requireStringArray(input.storeIds, '担当店舗') : []
  if (role === 'staff' && storeIds.length === 0) fail('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const target = await requireTarget(db, orgId, targetUid, tx)
    if (target.role === 'owner') fail('failed-precondition', 'オーナーの権限は変更できません。')
    tx.update(memberRef(db, orgId, targetUid), { role, storeIds })
    writeAuditLog(tx, db, orgId, 'member.updateRole', caller.uid, { targetUid, role, storeIds })
  })
}

export async function deleteMemberFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const targetUid = requireId(input.targetUid, 'メンバー')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const target = await requireTarget(db, orgId, targetUid, tx)
    if (target.role === 'owner') fail('failed-precondition', 'オーナーは削除できません。')
    if (targetUid === caller.uid) fail('failed-precondition', '自分自身は削除できません。')
    tx.delete(memberRef(db, orgId, targetUid))
    writeAuditLog(tx, db, orgId, 'member.delete', caller.uid, { targetUid })
  })
}

export async function updateOrganizationNameFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const name = requireString(input.name, '組織名', 100)

  await db.runTransaction(async (tx) => {
    await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner'], tx)
    tx.update(orgRef(db, orgId), { name, updatedAt: FieldValue.serverTimestamp() })
    writeAuditLog(tx, db, orgId, 'organization.updateName', caller.uid, { name })
  })
}
