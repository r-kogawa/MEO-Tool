import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { orgRef, requireMember, requireOrg } from '../shared/members'
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../shared/secrets'
import { asObject, requireId, requireString } from '../shared/validation'

// 組織ごとの Google OAuth クライアント（各組織が自社の GCP で作成したもの）

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

export interface OAuthClientSecretDoc {
  orgId: string
  clientId: string
  secret: EncryptedSecret
}

function secretRef(db: Firestore, orgId: string) {
  return db.doc(`oauthClientSecrets/${orgId}`)
}

/** 解除されていない（active / error の）連携 */
function activeConnectionsQuery(db: Firestore, orgId: string) {
  return db.collection(`organizations/${orgId}/googleConnections`).where('status', 'in', ['active', 'error'])
}

/** 復号したクライアント ID とシークレット。Functions 内でだけ使い、外に返さない */
export async function loadOAuthClient(db: Firestore, orgId: string): Promise<{ clientId: string; clientSecret: string }> {
  const snapshot = await secretRef(db, orgId).get()
  if (!snapshot.exists) {
    fail('failed-precondition', 'Google OAuth クライアントが登録されていません。Google 連携の設定画面で登録してください。')
  }
  const doc = snapshot.data() as OAuthClientSecretDoc
  return { clientId: doc.clientId, clientSecret: await decryptSecret(doc.secret) }
}

export async function updateGoogleOAuthClientFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const clientId = requireString(input.clientId, 'クライアント ID', 200)
  const clientSecret = requireString(input.clientSecret, 'クライアントシークレット', 200)
  if (!clientId.endsWith(CLIENT_ID_SUFFIX)) {
    fail('invalid-argument', 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。')
  }

  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner'])
  const secret = await encryptSecret(clientSecret)
  await db.runTransaction(async (tx) => {
    // refresh token は発行元のクライアントに紐づくため、連携が残っている間は ID を替えさせない（シークレットの更新は可）
    const [current, remaining] = await Promise.all([tx.get(secretRef(db, orgId)), tx.get(activeConnectionsQuery(db, orgId))])
    if (current.exists && current.get('clientId') !== clientId && !remaining.empty) {
      fail('failed-precondition', '連携中の Google アカウントがあるため、クライアント ID は変更できません。先に連携を解除してください。')
    }
    const doc: OAuthClientSecretDoc = { orgId, clientId, secret }
    tx.set(secretRef(db, orgId), { ...doc, updatedAt: FieldValue.serverTimestamp() })
    tx.update(orgRef(db, orgId), {
      googleOAuthClient: { clientId, configuredAt: FieldValue.serverTimestamp(), configuredBy: caller.uid },
    })
    writeAuditLog(tx, db, orgId, 'googleOAuthClient.update', caller.uid, { clientId })
  })
}

export async function deleteGoogleOAuthClientFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner'], tx)
    const remaining = await tx.get(activeConnectionsQuery(db, orgId))
    if (!remaining.empty) fail('failed-precondition', '連携中の Google アカウントがあります。先に連携を解除してください。')
    tx.delete(secretRef(db, orgId))
    tx.update(orgRef(db, orgId), { googleOAuthClient: null })
    writeAuditLog(tx, db, orgId, 'googleOAuthClient.delete', caller.uid)
  })
}

/** 各組織が自社の OAuth クライアントに登録するリダイレクト URI（全組織共通） */
export function requireCallbackUrl(): string {
  const url = process.env.OAUTH_CALLBACK_URL
  if (!url) fail('failed-precondition', 'コールバック URL（OAUTH_CALLBACK_URL）が設定されていません。運営にお問い合わせください。')
  return url
}

export async function getGoogleOAuthConfigFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ callbackUrl: string }> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  return { callbackUrl: requireCallbackUrl() }
}
