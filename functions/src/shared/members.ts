import type { DocumentReference, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore'
import { fail } from './errors'

export type MemberRole = 'owner' | 'admin' | 'staff'
export type OrgType = 'individual' | 'corporate'

export interface OrgLimits {
  maxStores: number
  maxSurveys: number
  maxKeywords: number
  maxMembers: number
  monthlyReviewDrafts: number
  monthlyRankChecks: number
}

export interface OrgDoc {
  type: OrgType
  name: string
  plan: string
  status: 'active' | 'suspended' | 'deleted'
  limits: OrgLimits
  ownerUid: string
}

export interface MemberDoc {
  orgId: string
  uid: string
  role: MemberRole
  storeIds: string[]
  email: string
  displayName: string
  joinedAt: Timestamp
}

export function orgRef(db: Firestore, orgId: string): DocumentReference {
  return db.doc(`organizations/${orgId}`)
}

export function memberRef(db: Firestore, orgId: string, uid: string): DocumentReference {
  return db.doc(`organizations/${orgId}/members/${uid}`)
}

function read(ref: DocumentReference, tx?: Transaction) {
  return tx ? tx.get(ref) : ref.get()
}

export async function requireOrg(db: Firestore, orgId: string, tx?: Transaction): Promise<OrgDoc> {
  const snapshot = await read(orgRef(db, orgId), tx)
  if (!snapshot.exists) fail('not-found', '組織が見つかりません。')
  const org = snapshot.data() as OrgDoc
  if (org.status !== 'active') fail('failed-precondition', 'この組織は利用停止中です。')
  return org
}

export async function requireMember(
  db: Firestore,
  orgId: string,
  uid: string,
  roles?: MemberRole[],
  tx?: Transaction,
): Promise<MemberDoc> {
  const snapshot = await read(memberRef(db, orgId, uid), tx)
  if (!snapshot.exists) fail('permission-denied', 'この組織のメンバーではありません。')
  const member = snapshot.data() as MemberDoc
  if (roles && !roles.includes(member.role)) fail('permission-denied', 'この操作の権限がありません。')
  return member
}

/** staff は担当店舗だけ操作できる */
export function requireStoreAccess(member: MemberDoc, storeId: string): void {
  if (member.role === 'staff' && !member.storeIds.includes(storeId)) fail('permission-denied', '担当外の店舗です。')
}
