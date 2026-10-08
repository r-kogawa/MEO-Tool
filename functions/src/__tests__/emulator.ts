import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import type { MemberRole, OrgType } from '../shared/members'

export const TEST_PROJECT_ID = 'demo-meo-tool'

// テストは常にローカル暗号を使う（KMS を呼ばない）
process.env.SECRET_CIPHER = 'local'

export function getTestDb(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST が未設定です。ルートで npm run test:emulator を実行してください')
  }
  const app = getApps()[0] ?? initializeApp({ projectId: TEST_PROJECT_ID })
  return getFirestore(app)
}

export async function clearFirestore(): Promise<void> {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`
  const response = await fetch(url, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Firestore のクリアに失敗しました: HTTP ${response.status}`)
}

export function caller(uid: string, email = `${uid}@example.com`, isEmailVerified = true): Caller {
  return { uid, email, isEmailVerified }
}

interface SeedMember {
  uid: string
  role: MemberRole
  storeIds?: string[]
  email?: string
}

interface SeedOrgInput {
  orgId: string
  type?: OrgType
  status?: 'active' | 'suspended' | 'deleted'
  maxMembers?: number
  members: SeedMember[]
}

export async function seedOrg(db: Firestore, input: SeedOrgInput): Promise<void> {
  const owner = input.members.find(member => member.role === 'owner')
  await db.doc(`organizations/${input.orgId}`).set({
    type: input.type ?? 'corporate',
    name: `組織 ${input.orgId}`,
    plan: 'ビジネス',
    status: input.status ?? 'active',
    limits: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: input.maxMembers ?? 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
    ownerUid: owner?.uid ?? 'nobody',
    createdAt: FieldValue.serverTimestamp(),
  })
  for (const member of input.members) {
    await db.doc(`organizations/${input.orgId}/members/${member.uid}`).set({
      orgId: input.orgId,
      uid: member.uid,
      role: member.role,
      storeIds: member.storeIds ?? [],
      email: member.email ?? `${member.uid}@example.com`,
      displayName: member.uid,
      joinedAt: FieldValue.serverTimestamp(),
    })
  }
}

export async function seedStore(db: Firestore, orgId: string, storeId: string, name: string): Promise<void> {
  await db.doc(`organizations/${orgId}/stores/${storeId}`).set({ orgId, name, status: 'active' })
}
