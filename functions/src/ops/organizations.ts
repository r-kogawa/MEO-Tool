import { getAuth } from 'firebase-admin/auth'
import type { DocumentSnapshot, Firestore, Timestamp } from 'firebase-admin/firestore'
import { toJstMonthKey } from '../rankings/validation'
import { writeAuditLog } from '../shared/audit'
import { requireOperator, type Caller } from '../shared/auth'
import { signupProfileRef, type Industry, type SignupSource, type SignupVia, type StoreCount } from '../identity/signupProfile'
import { fail } from '../shared/errors'
import { orgRef, type MemberRole, type OrgDoc, type OrgLimits } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { surveysOf } from '../surveys/publicSurvey'

// 運営画面（docs/superpowers/specs/2026-10-18-ops-console-design.md 3 章）。
// 運営者（Custom Claims の operator）だけが呼べる。運営者は組織のメンバーではないため requireMember / requireOrg は使わない

export interface OpsOrganization {
  id: string
  type: OrgDoc['type']
  name: string
  plan: string
  status: 'active' | 'suspended'
  limits: OrgLimits
  ownerUid: string
  createdAt: string
}

export interface OpsSignupProfile {
  phone: string
  industry: Industry
  storeCount: StoreCount
  via: SignupVia
  source: SignupSource | null
}

export interface OpsOrganizationSummary {
  org: OpsOrganization
  ownerName: string
  ownerEmail: string
  stores: number
  members: number
  hasConnectionError: boolean
  /** 登録時の入力。プロフィールの無い既存組織は null */
  signup: OpsSignupProfile | null
}

export interface OpsOrganizationDetail extends OpsOrganizationSummary {
  connections: { id: string; googleEmail: string; status: 'active' | 'error' | 'revoked'; lastError: string | null }[]
  usage: { responses: number; reviewDrafts: number; rankChecks: number } | null
  memberList: { uid: string; displayName: string; email: string; role: MemberRole }[]
  storeList: { id: string; name: string; address: string; status: 'active' | 'archived' }[]
}

export interface OpsDeps {
  /** Auth に今設定されている Custom Claims */
  loadClaims: (uid: string) => Promise<Record<string, unknown>>
}

export const defaultOpsDeps: OpsDeps = {
  loadClaims: async uid => (await getAuth().getUser(uid)).customClaims ?? {},
}

/**
 * ID トークンの claims に加えて、Auth の今の claims も確かめる。
 * 発行済みの ID トークンは剥奪後も最大 1 時間有効なため、ops:grant --revoke をすぐに効かせる
 */
async function requireCurrentOperator(caller: Caller, deps: OpsDeps): Promise<void> {
  requireOperator(caller)
  if ((await deps.loadClaims(caller.uid)).operator !== true) fail('permission-denied', '運営権限がありません。')
}

/** 退会済み（deleted）と存在しない組織は、運営画面でも見つからない扱い */
export function isVisibleOrg(snapshot: DocumentSnapshot): boolean {
  return snapshot.exists && snapshot.get('status') !== 'deleted'
}

function toIso(value: unknown): string {
  const timestamp = value as Timestamp | undefined
  return typeof timestamp?.toDate === 'function' ? timestamp.toDate().toISOString() : new Date(0).toISOString()
}

function toOpsOrganization(snapshot: DocumentSnapshot): OpsOrganization {
  const data = snapshot.data() as OrgDoc & { createdAt?: Timestamp }
  return {
    id: snapshot.id,
    type: data.type,
    name: data.name,
    plan: data.plan,
    status: data.status === 'suspended' ? 'suspended' : 'active',
    limits: data.limits,
    ownerUid: data.ownerUid,
    createdAt: toIso(data.createdAt),
  }
}

async function summarize(db: Firestore, snapshot: DocumentSnapshot): Promise<OpsOrganizationSummary> {
  const org = toOpsOrganization(snapshot)
  const base = orgRef(db, org.id)
  const [owner, stores, members, errors, signup] = await Promise.all([
    base.collection('members').doc(org.ownerUid).get(),
    base.collection('stores').where('status', '==', 'active').count().get(),
    base.collection('members').count().get(),
    base.collection('googleConnections').where('status', '==', 'error').limit(1).get(),
    signupProfileRef(db, org.id).get(),
  ])
  return {
    org,
    ownerName: owner.get('displayName') ?? '—',
    ownerEmail: owner.get('email') ?? '—',
    stores: stores.data().count,
    members: members.data().count,
    hasConnectionError: !errors.empty,
    signup: signup.exists
      ? { phone: signup.get('phone'), industry: signup.get('industry'), storeCount: signup.get('storeCount'), via: signup.get('via'), source: signup.get('source') ?? null }
      : null,
  }
}

export async function getOpsOrganizationsFunc(db: Firestore, caller: Caller, _data: unknown, deps = defaultOpsDeps): Promise<OpsOrganizationSummary[]> {
  await requireCurrentOperator(caller, deps)
  const snapshot = await db.collection('organizations').where('status', 'in', ['active', 'suspended']).get()
  const list = await Promise.all(snapshot.docs.map(doc => summarize(db, doc)))
  return list.sort((a, b) => b.org.createdAt.localeCompare(a.org.createdAt))
}

export async function getOpsOrganizationFunc(db: Firestore, caller: Caller, data: unknown, deps = defaultOpsDeps, now = new Date()): Promise<OpsOrganizationDetail> {
  await requireCurrentOperator(caller, deps)
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  const snapshot = await orgRef(db, orgId).get()
  if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
  const base = snapshot.ref
  const [summary, connections, usage, members, stores] = await Promise.all([
    summarize(db, snapshot),
    base.collection('googleConnections').get(),
    base.collection('usageMonthly').doc(toJstMonthKey(now)).get(),
    base.collection('members').get(),
    base.collection('stores').get(),
  ])
  return {
    ...summary,
    // トークン・秘密は oauthTokens 側にあり、ここには含まれない。念のため表示に使う項目だけを返す
    connections: connections.docs.map(doc => ({ id: doc.id, googleEmail: doc.get('googleEmail') ?? '', status: doc.get('status'), lastError: doc.get('lastError') ?? null })),
    usage: usage.exists
      ? { responses: usage.get('responses') ?? 0, reviewDrafts: usage.get('reviewDrafts') ?? 0, rankChecks: usage.get('rankChecks') ?? 0 }
      : null,
    memberList: members.docs.map(doc => ({ uid: doc.get('uid'), displayName: doc.get('displayName'), email: doc.get('email'), role: doc.get('role') })),
    storeList: stores.docs.map(doc => ({ id: doc.id, name: doc.get('name'), address: doc.get('address') ?? '', status: doc.get('status') })),
  }
}

const SETTABLE_STATUSES = ['active', 'suspended'] as const
const LIMIT_KEYS = ['maxStores', 'maxSurveys', 'maxKeywords', 'maxMembers', 'monthlyReviewDrafts', 'monthlyRankChecks'] as const satisfies readonly (keyof OrgLimits)[]

function requireLimits(value: unknown): OrgLimits {
  const input = asObject(value)
  const limits = {} as OrgLimits
  for (const key of LIMIT_KEYS) {
    const item = input[key]
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) fail('invalid-argument', '上限値は 0 以上の整数で入力してください。')
    limits[key] = item
  }
  return limits
}

/**
 * 利用停止 / 再開。同じトランザクションで回答画面の公開データ（publicSurveys）をそろえる。
 * 再開時の戻し先は停止前の値を持たず、その都度 surveys の status から導く（停止中の変更とずれないように）
 */
export async function updateOrganizationStatusFunc(db: Firestore, caller: Caller, data: unknown, deps = defaultOpsDeps): Promise<void> {
  await requireCurrentOperator(caller, deps)
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const status = requireOneOf(input.status, SETTABLE_STATUSES, '状態')

  await db.runTransaction(async (tx) => {
    const ref = orgRef(db, orgId)
    const snapshot = await tx.get(ref)
    if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
    const from = snapshot.get('status')
    if (from === status) return
    const publicSurveys = await tx.get(db.collection('publicSurveys').where('orgId', '==', orgId))
    const surveys = await Promise.all(publicSurveys.docs.map(doc => tx.get(surveysOf(db, orgId).doc(doc.get('surveyId')))))

    tx.update(ref, { status })
    publicSurveys.docs.forEach((doc, index) => {
      const isPublished = status === 'active' && surveys[index]?.get('status') === 'published'
      tx.update(doc.ref, { status: isPublished ? 'published' : 'paused' })
    })
    writeAuditLog(tx, db, orgId, 'ops.updateOrganizationStatus', caller.uid, { from, to: status })
  })
}

export async function updateOrganizationPlanFunc(db: Firestore, caller: Caller, data: unknown, deps = defaultOpsDeps): Promise<void> {
  await requireCurrentOperator(caller, deps)
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const plan = requireString(input.plan, 'プラン名', 50)
  const limits = requireLimits(input.limits)

  await db.runTransaction(async (tx) => {
    const ref = orgRef(db, orgId)
    const snapshot = await tx.get(ref)
    if (!isVisibleOrg(snapshot)) fail('not-found', '組織が見つかりません。')
    tx.update(ref, { plan, limits })
    writeAuditLog(tx, db, orgId, 'ops.updateOrganizationPlan', caller.uid, {
      plan,
      limits,
      before: { plan: snapshot.get('plan'), limits: snapshot.get('limits') },
    })
  })
}
