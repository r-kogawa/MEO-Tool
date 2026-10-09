import { createHash, randomBytes } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { appUrl } from '../shared/appUrl'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { smtpMailer, type Mailer } from '../shared/mail'
import { memberRef, orgRef, requireMember, requireOrg, type OrgDoc, type OrgType } from '../shared/members'
import { asObject, requireEmail, requireId, requireOneOf, requireString, requireStringArray } from '../shared/validation'
import { buildInvitationMail } from './invitationMail'

const INVITABLE_ROLES = ['admin', 'staff'] as const
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000

type InvitableRole = typeof INVITABLE_ROLES[number]
type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

interface InvitationDoc {
  orgId: string
  email: string
  role: InvitableRole
  storeIds: string[]
  status: Exclude<InvitationStatus, 'expired'>
  tokenHash: string
  expiresAt: Timestamp
  invitedBy: string
  createdAt?: Timestamp
}

/** クライアントの Invitation 型と同じ形 */
export interface InvitationResult {
  id: string
  orgId: string
  email: string
  role: InvitableRole
  storeIds: string[]
  status: InvitationStatus
  token: string
  expiresAt: string
  invitedBy: string
  createdAt: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isActivePending(invitation: InvitationDoc, now = Date.now()): boolean {
  return invitation.status === 'pending' && invitation.expiresAt.toMillis() > now
}

function toResult(id: string, invitation: InvitationDoc, token: string, invitedBy: string): InvitationResult {
  const isExpired = invitation.status === 'pending' && !isActivePending(invitation)
  return {
    id,
    orgId: invitation.orgId,
    email: invitation.email,
    role: invitation.role,
    storeIds: invitation.storeIds,
    status: isExpired ? 'expired' : invitation.status,
    token,
    expiresAt: invitation.expiresAt.toDate().toISOString(),
    invitedBy,
    createdAt: (invitation.createdAt ?? Timestamp.now()).toDate().toISOString(),
  }
}

async function findByToken(db: Firestore, token: string): Promise<DocumentSnapshot> {
  const snapshot = await db.collectionGroup('invitations').where('tokenHash', '==', hashToken(token)).limit(1).get()
  if (snapshot.empty) fail('not-found', '招待が見つかりません。URL をご確認ください。')
  return snapshot.docs[0]
}

/** F-03 招待の作成（法人のみ・owner / admin）。作成後に招待メールを送る。送れなくても招待は有効（画面から URL を共有できる） */
export async function createInvitationFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  mailer: Mailer = smtpMailer,
): Promise<InvitationResult & { isMailSent: boolean }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const email = requireEmail(input.email)
  const role = requireOneOf(input.role, INVITABLE_ROLES, '権限')
  const storeIds = role === 'staff' ? requireStringArray(input.storeIds, '担当店舗') : []
  if (role === 'staff' && storeIds.length === 0) fail('invalid-argument', 'スタッフには担当店舗を 1 つ以上選んでください。')

  const token = randomBytes(24).toString('base64url')
  const { result, orgName } = await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    if (org.type !== 'corporate') fail('failed-precondition', 'メンバー招待は法人組織のみ利用できます。')

    const [members, pending, stores] = await Promise.all([
      tx.get(db.collection(`organizations/${orgId}/members`)),
      tx.get(db.collection(`organizations/${orgId}/invitations`).where('status', '==', 'pending')),
      Promise.all(storeIds.map(id => tx.get(db.doc(`organizations/${orgId}/stores/${id}`)))),
    ])
    const activePending = pending.docs.filter(doc => isActivePending(doc.data() as InvitationDoc))
    if (members.size + activePending.length >= org.limits.maxMembers) {
      fail('resource-exhausted', `メンバー数の上限（${org.limits.maxMembers} 名）に達しています。`)
    }
    if (members.docs.some(doc => String(doc.get('email')).toLowerCase() === email)) fail('already-exists', 'すでにメンバーです。')
    if (activePending.some(doc => doc.get('email') === email)) fail('already-exists', 'このメールアドレスには招待を送信済みです。')
    if (stores.some(store => !store.exists)) fail('invalid-argument', '担当店舗に存在しない店舗が含まれています。')

    const ref = db.collection(`organizations/${orgId}/invitations`).doc()
    const now = Timestamp.now()
    const invitation: InvitationDoc = {
      orgId,
      email,
      role,
      storeIds,
      status: 'pending',
      tokenHash: hashToken(token),
      expiresAt: Timestamp.fromMillis(now.toMillis() + EXPIRES_IN_MS),
      invitedBy: caller.uid,
      createdAt: now,
    }
    tx.create(ref, invitation)
    writeAuditLog(tx, db, orgId, 'invitation.create', caller.uid, { invitationId: ref.id, email, role })
    return { result: toResult(ref.id, invitation, token, caller.uid), orgName: org.name }
  })
  return { ...result, isMailSent: await sendInvitationMail(mailer, result, orgName) }
}

/** 招待メールを送り、送れたかを返す（トランザクションの外で 1 回だけ送る） */
async function sendInvitationMail(mailer: Mailer, invitation: InvitationResult, orgName: string): Promise<boolean> {
  try {
    await mailer.send(buildInvitationMail({
      to: invitation.email,
      orgName,
      role: invitation.role,
      url: appUrl(`/invite/${invitation.token}`),
      expiresAt: new Date(invitation.expiresAt),
    }))
    return true
  }
  catch (error) {
    logger.error('招待メールの送信に失敗', { orgId: invitation.orgId, invitationId: invitation.id, error: String(error) })
    return false
  }
}

/** 招待画面（未ログインでも開ける）向けの確認。トークンは返さない */
export async function getInvitationFunc(
  db: Firestore,
  data: unknown,
): Promise<{ invitation: InvitationResult; org: { name: string; type: OrgType }; storeNames: string[] }> {
  const token = requireString(asObject(data).token, '招待トークン', 128)
  const snapshot = await findByToken(db, token)
  const invitation = snapshot.data() as InvitationDoc
  const [orgSnapshot, ...storeSnapshots] = await Promise.all([
    orgRef(db, invitation.orgId).get(),
    ...invitation.storeIds.map(id => db.doc(`organizations/${invitation.orgId}/stores/${id}`).get()),
  ])
  const org = orgSnapshot.data() as OrgDoc | undefined
  if (!org) fail('not-found', '招待が見つかりません。URL をご確認ください。')
  return {
    invitation: toResult(snapshot.id, invitation, '', ''),
    org: { name: org.name, type: org.type },
    storeNames: storeSnapshots.map((store, index) => String(store.get('name') ?? invitation.storeIds[index])),
  }
}

/** 招待の受諾。招待されたメールアドレスのアカウントだけが受諾できる */
export async function updateInvitationAcceptFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ orgId: string }> {
  const input = asObject(data)
  const token = requireString(input.token, '招待トークン', 128)
  const displayName = requireString(input.displayName, '表示名', 50)
  const found = await findByToken(db, token)

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(found.ref)
    const invitation = snapshot.data() as InvitationDoc
    const userRef = db.doc(`users/${caller.uid}`)
    const [member, user] = await Promise.all([tx.get(memberRef(db, invitation.orgId, caller.uid)), tx.get(userRef)])
    await requireOrg(db, invitation.orgId, tx)

    if (!isActivePending(invitation)) fail('failed-precondition', 'この招待は無効です（期限切れ・取消済み・受諾済み）。')
    // メールアドレスの一致で本人と判定するため、所有を確認済みのアカウントに限る（招待 URL が転送された場合のなりすまし対策）
    if (!caller.isEmailVerified) {
      fail('failed-precondition', 'メールアドレスの確認が完了していません。確認メールのリンクを開いてから、もう一度お試しください。')
    }
    if (caller.email !== invitation.email) {
      fail('permission-denied', `招待されたメールアドレス（${invitation.email}）でログインしてください。`)
    }
    if (member.exists) fail('already-exists', 'すでにこの組織のメンバーです。')

    const now = FieldValue.serverTimestamp()
    tx.create(memberRef(db, invitation.orgId, caller.uid), {
      orgId: invitation.orgId,
      uid: caller.uid,
      role: invitation.role,
      storeIds: invitation.storeIds,
      email: caller.email,
      displayName,
      joinedAt: now,
    })
    tx.update(snapshot.ref, { status: 'accepted', acceptedBy: caller.uid, acceptedAt: now })
    tx.set(userRef, {
      email: caller.email,
      displayName,
      lastOrgId: invitation.orgId,
      updatedAt: now,
      ...(user.exists ? {} : { platformRole: null, createdAt: now }),
    }, { merge: true })
    writeAuditLog(tx, db, invitation.orgId, 'invitation.accept', caller.uid, { invitationId: snapshot.id })
    return { orgId: invitation.orgId }
  })
}

export async function updateInvitationRevokeFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const invitationId = requireId(input.invitationId, '招待 ID')

  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const snapshot = await tx.get(db.doc(`organizations/${orgId}/invitations/${invitationId}`))
    if (!snapshot.exists || !isActivePending(snapshot.data() as InvitationDoc)) fail('not-found', '取り消せる招待がありません。')
    tx.update(snapshot.ref, { status: 'revoked', revokedBy: caller.uid, revokedAt: FieldValue.serverTimestamp() })
    writeAuditLog(tx, db, orgId, 'invitation.revoke', caller.uid, { invitationId })
  })
}
