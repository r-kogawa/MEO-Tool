import { randomBytes } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import type { GbpAccount } from '../shared/gbp'
import { requireMember, requireOrg } from '../shared/members'
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../shared/secrets'
import { asObject, requireId } from '../shared/validation'
import { defaultGoogleDeps, type ExchangedTokens, type GoogleDeps } from './deps'
import { loadOAuthClient, requireCallbackUrl } from './oauthClient'

// F-04 Google 連携。組織ごとの OAuth クライアントで認可し、refresh token を暗号化して保存する。

export const GBP_SCOPES = ['https://www.googleapis.com/auth/business.manage', 'openid', 'email']
const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthStateDoc {
  orgId: string
  uid: string
  expiresAt: Timestamp
}

type CallbackErrorCode = 'access_denied' | 'invalid_client' | 'exchange_failed' | 'no_refresh_token' | 'gbp_accounts_failed' | 'save_failed'

function appUrl(path: string): string {
  return `${(process.env.ADMIN_APP_URL ?? '').replace(/\/$/, '')}${path}`
}

function settingsUrl(orgId: string, query: string): string {
  return appUrl(`/admin/${orgId}/settings/google?${query}`)
}

export async function createGoogleAuthUrlFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ url: string }> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const { clientId } = await loadOAuthClient(db, orgId)
  const redirectUri = requireCallbackUrl()

  const state = randomBytes(24).toString('base64url')
  await db.doc(`oauthStates/${state}`).set({
    orgId,
    uid: caller.uid,
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
    createdAt: FieldValue.serverTimestamp(),
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return { url: url.toString() }
}

/** state を 1 回だけ使えるように、読むと同時に削除する。不正・期限切れなら null */
async function consumeState(db: Firestore, state: string | undefined): Promise<OAuthStateDoc | null> {
  if (!state || !/^[A-Za-z0-9_-]+$/.test(state)) return null
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`oauthStates/${state}`)
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return null
    tx.delete(ref)
    const doc = snapshot.data() as OAuthStateDoc
    return doc.expiresAt.toMillis() > Date.now() ? doc : null
  })
}

function toCallbackErrorCode(error: unknown): CallbackErrorCode {
  const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error
  return code === 'invalid_client' || code === 'unauthorized_client' ? 'invalid_client' : 'exchange_failed'
}

/**
 * OAuth のコールバック（onRequest）の本体。リダイレクト先の URL を返す。
 * 同じ組織で同じ Google アカウントの連携があれば、それを更新する（再認証）。
 */
export async function handleGoogleOAuthCallback(
  db: Firestore,
  query: { code?: string; state?: string; error?: string },
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<string> {
  const state = await consumeState(db, query.state)
  if (!state) return appUrl('/orgs?googleError=invalid_state')
  const errorUrl = (code: CallbackErrorCode) => settingsUrl(state.orgId, `error=${code}`)
  if (query.error || !query.code) return errorUrl('access_denied')

  let tokens: ExchangedTokens
  try {
    const client = await loadOAuthClient(db, state.orgId)
    tokens = await deps.exchangeCode({ ...client, redirectUri: requireCallbackUrl(), code: query.code })
  }
  catch (error) {
    logger.warn('OAuth のコード交換に失敗しました', { orgId: state.orgId, error: String(error) })
    return errorUrl(toCallbackErrorCode(error))
  }
  if (!tokens.refreshToken) return errorUrl('no_refresh_token')

  let accounts
  try {
    accounts = await deps.listAccounts(tokens.accessToken)
  }
  catch (error) {
    logger.warn('GBP アカウントの取得に失敗しました', { orgId: state.orgId, error: String(error) })
    return errorUrl('gbp_accounts_failed')
  }

  const googleEmail = tokens.googleEmail.toLowerCase()
  try {
    await saveConnection(db, state, googleEmail, tokens.refreshToken, accounts)
  }
  catch (error) {
    // KMS の権限不足など。利用者を Functions のエラー画面で止めず、設定画面へ戻す
    logger.error('Google 連携の保存に失敗しました', { orgId: state.orgId, error: String(error) })
    return errorUrl('save_failed')
  }
  return settingsUrl(state.orgId, 'connected=1')
}

async function saveConnection(
  db: Firestore,
  state: OAuthStateDoc,
  googleEmail: string,
  refreshToken: string,
  accounts: GbpAccount[],
): Promise<void> {
  const secret = await encryptSecret(refreshToken)
  await db.runTransaction(async (tx) => {
    const collection = db.collection(`organizations/${state.orgId}/googleConnections`)
    const existing = await tx.get(collection.where('googleEmail', '==', googleEmail).limit(1))
    const ref = existing.empty ? collection.doc() : existing.docs[0].ref
    const now = FieldValue.serverTimestamp()
    tx.set(ref, {
      orgId: state.orgId,
      googleEmail,
      gbpAccounts: accounts.map(account => ({ name: account.name, accountName: account.accountName ?? account.name, type: account.type ?? null })),
      scopes: GBP_SCOPES,
      status: 'active',
      lastError: null,
      connectedBy: state.uid,
      connectedAt: now,
    })
    tx.set(db.doc(`oauthTokens/${ref.id}`), { orgId: state.orgId, secret, updatedAt: now })
    writeAuditLog(tx, db, state.orgId, existing.empty ? 'googleConnection.create' : 'googleConnection.reauthorize', state.uid, { connectionId: ref.id, googleEmail })
  })
}

/** 解除しても取込済みの店舗は残す（口コミ URL は placeId だけで動くため） */
export async function deleteGoogleConnectionFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const connectionId = requireId(input.connectionId, '連携 ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const connectionRef = db.doc(`organizations/${orgId}/googleConnections/${connectionId}`)
  if (!(await connectionRef.get()).exists) fail('not-found', '連携が見つかりません。')

  const tokenRef = db.doc(`oauthTokens/${connectionId}`)
  const token = await tokenRef.get()
  if (token.exists) {
    try {
      await deps.revokeToken(await decryptSecret(token.get('secret') as EncryptedSecret))
    }
    catch (error) {
      // 既に Google 側で取り消されている場合など。こちらの削除は続ける
      logger.warn('Google 側のトークン取り消しに失敗しました', { orgId, connectionId, error: String(error) })
    }
  }
  await db.runTransaction(async (tx) => {
    tx.delete(tokenRef)
    tx.update(connectionRef, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid })
    writeAuditLog(tx, db, orgId, 'googleConnection.delete', caller.uid, { connectionId })
  })
}
