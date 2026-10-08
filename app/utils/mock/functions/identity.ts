import type { Invitation, MemberRole, OrgType } from '~/types/domain'
import { invitationStatusOf } from '../../invitationStatus'
import { createId } from '../random'
import type { MockDb } from '../seed'
import { MockFunctionsError, requireMember, requireOrg } from './shared'

// identity/ … 組織作成・招待・メンバー権限（docs/04-features.md F-01, F-03）

const DEFAULT_LIMITS = {
  individual: { maxStores: 1, maxSurveys: 3, maxKeywords: 5, maxMembers: 1, monthlyReviewDrafts: 100, monthlyRankChecks: 200 },
  corporate: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
} as const

interface CreateOrganizationInput {
  uid: string
  email: string
  displayName: string
  type: OrgType
  orgName: string
}

export function createOrganizationFunc(db: MockDb, input: CreateOrganizationInput): string {
  const now = new Date().toISOString()
  const orgId = createId('org')
  db.organizations.push({
    id: orgId,
    type: input.type,
    name: input.orgName,
    plan: input.type === 'individual' ? 'ライト' : 'ビジネス',
    status: 'active',
    limits: { ...DEFAULT_LIMITS[input.type] },
    ownerUid: input.uid,
    createdAt: now,
  })
  db.members.push({
    orgId,
    uid: input.uid,
    role: 'owner',
    storeIds: [],
    email: input.email,
    displayName: input.displayName,
    joinedAt: now,
  })
  return orgId
}

interface CreateInvitationInput {
  orgId: string
  email: string
  role: Exclude<MemberRole, 'owner'>
  storeIds: string[]
}

export function createInvitationFunc(db: MockDb, uid: string, input: CreateInvitationInput): Invitation {
  const org = requireOrg(db, input.orgId)
  requireMember(db, input.orgId, uid, ['owner', 'admin'])
  if (org.type !== 'corporate') throw new MockFunctionsError('failed-precondition', 'メンバー招待は法人組織のみ利用できます。')

  const email = input.email.trim().toLowerCase()
  const memberCount = db.members.filter(item => item.orgId === org.id).length
  const pendingCount = db.invitations.filter(item => item.orgId === org.id && invitationStatusOf(item) === 'pending').length
  if (memberCount + pendingCount >= org.limits.maxMembers) {
    throw new MockFunctionsError('resource-exhausted', `メンバー数の上限（${org.limits.maxMembers} 名）に達しています。`)
  }
  if (db.members.some(item => item.orgId === org.id && item.email === email)) {
    throw new MockFunctionsError('already-exists', 'すでにメンバーです。')
  }
  if (db.invitations.some(item => item.orgId === org.id && item.email === email && invitationStatusOf(item) === 'pending')) {
    throw new MockFunctionsError('already-exists', 'このメールアドレスには招待を送信済みです。')
  }
  if (input.role === 'staff' && input.storeIds.length === 0) {
    throw new MockFunctionsError('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')
  }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)
  const invitation: Invitation = {
    id: createId('inv'),
    orgId: org.id,
    email,
    role: input.role,
    storeIds: input.role === 'staff' ? [...input.storeIds] : [],
    status: 'pending',
    token: createId('token'),
    expiresAt: expiresAt.toISOString(),
    invitedBy: uid,
    createdAt: new Date().toISOString(),
  }
  db.invitations.push(invitation)
  return invitation
}

export function findInvitationByToken(db: MockDb, token: string): Invitation {
  const invitation = db.invitations.find(item => item.token === token)
  if (!invitation) throw new MockFunctionsError('not-found', '招待が見つかりません。URL をご確認ください。')
  return invitation
}

export function updateInvitationAcceptFunc(db: MockDb, uid: string, token: string): string {
  const invitation = findInvitationByToken(db, token)
  if (invitationStatusOf(invitation) !== 'pending') {
    throw new MockFunctionsError('failed-precondition', 'この招待は無効です（期限切れ・取消済み・受諾済み）。')
  }
  const user = db.users.find(item => item.uid === uid)
  if (!user) throw new MockFunctionsError('unauthenticated', 'ログインしてください。')
  if (user.email !== invitation.email) {
    throw new MockFunctionsError('permission-denied', `招待されたメールアドレス（${invitation.email}）でログインしてください。`)
  }
  if (db.members.some(item => item.orgId === invitation.orgId && item.uid === uid)) {
    throw new MockFunctionsError('already-exists', 'すでにこの組織のメンバーです。')
  }
  db.members.push({
    orgId: invitation.orgId,
    uid,
    role: invitation.role,
    storeIds: [...invitation.storeIds],
    email: user.email,
    displayName: user.displayName,
    joinedAt: new Date().toISOString(),
  })
  invitation.status = 'accepted'
  return invitation.orgId
}

export function updateInvitationRevokeFunc(db: MockDb, uid: string, orgId: string, invitationId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const invitation = db.invitations.find(item => item.id === invitationId && item.orgId === orgId)
  if (!invitation || invitationStatusOf(invitation) !== 'pending') throw new MockFunctionsError('not-found', '取り消せる招待がありません。')
  invitation.status = 'revoked'
}

interface UpdateMemberRoleInput {
  orgId: string
  targetUid: string
  role: Exclude<MemberRole, 'owner'>
  storeIds: string[]
}

export function updateMemberRoleFunc(db: MockDb, uid: string, input: UpdateMemberRoleInput): void {
  requireMember(db, input.orgId, uid, ['owner', 'admin'])
  const target = requireMember(db, input.orgId, input.targetUid)
  if (target.role === 'owner') throw new MockFunctionsError('failed-precondition', 'オーナーの権限は変更できません。')
  if (input.role === 'staff' && input.storeIds.length === 0) {
    throw new MockFunctionsError('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')
  }
  target.role = input.role
  target.storeIds = input.role === 'staff' ? [...input.storeIds] : []
}

export function deleteMemberFunc(db: MockDb, uid: string, orgId: string, targetUid: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const target = requireMember(db, orgId, targetUid)
  if (target.role === 'owner') throw new MockFunctionsError('failed-precondition', 'オーナーは削除できません。')
  if (targetUid === uid) throw new MockFunctionsError('failed-precondition', '自分自身は削除できません。')
  db.members.splice(db.members.indexOf(target), 1)
}
