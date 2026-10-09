import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { memberRef, orgRef, type OrgDoc, type OrgType } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { DEFAULT_LIMITS, PLAN_NAMES } from './limits'

const ORG_TYPES: readonly OrgType[] = ['individual', 'corporate']

export interface CreateOrganizationInput {
  requestId: string
  type: OrgType
  orgName: string
  displayName: string
}

export function parseCreateOrganizationInput(data: unknown): CreateOrganizationInput {
  const input = asObject(data)
  return {
    requestId: requireId(input.requestId, 'リクエスト ID'),
    type: requireOneOf(input.type, ORG_TYPES, '組織種別'),
    orgName: requireString(input.orgName, '組織名', 100),
    displayName: requireString(input.displayName, '表示名', 50),
  }
}

/** F-01 新規登録（画面から）: ログイン中のユーザーを owner にして組織を作る */
export async function createOrganizationFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ orgId: string }> {
  return createOrganization(db, caller, parseCreateOrganizationInput(data))
}

/**
 * 組織と owner メンバーを作る。
 * 組織 ID を呼び出し元が発行した requestId から決めるため、再送しても組織は 1 つだけ。
 */
export async function createOrganization(db: Firestore, caller: Caller, input: CreateOrganizationInput): Promise<{ orgId: string }> {
  const { requestId, type, orgName, displayName } = input
  const orgId = `org-${requestId}`

  return db.runTransaction(async (tx) => {
    const userRef = db.doc(`users/${caller.uid}`)
    const [existingOrg, existingUser] = await Promise.all([tx.get(orgRef(db, orgId)), tx.get(userRef)])
    if (existingOrg.exists) {
      if ((existingOrg.data() as OrgDoc).ownerUid !== caller.uid) fail('already-exists', 'この組織はすでに作成されています。')
      return { orgId }
    }

    const now = FieldValue.serverTimestamp()
    // platformRole（運営フラグ）は新規ユーザーにだけ初期値を入れる。既存ユーザーは上書きしない
    tx.set(userRef, {
      email: caller.email,
      displayName,
      lastOrgId: orgId,
      updatedAt: now,
      ...(existingUser.exists ? {} : { platformRole: null, createdAt: now }),
    }, { merge: true })
    tx.create(orgRef(db, orgId), {
      type,
      name: orgName,
      plan: PLAN_NAMES[type],
      status: 'active',
      limits: { ...DEFAULT_LIMITS[type] },
      ownerUid: caller.uid,
      createdAt: now,
      updatedAt: now,
    })
    tx.create(memberRef(db, orgId, caller.uid), {
      orgId,
      uid: caller.uid,
      role: 'owner',
      storeIds: [],
      email: caller.email,
      displayName,
      joinedAt: now,
    })
    writeAuditLog(tx, db, orgId, 'organization.create', caller.uid)
    return { orgId }
  })
}
