import type { Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/https'
import { fail } from '../shared/errors'
import { GbpApiError, GbpAuthError, type GbpClient } from '../shared/gbp'
import { decryptSecret, type EncryptedSecret } from '../shared/secrets'
import { defaultGoogleDeps, type GoogleDeps } from './deps'
import { loadOAuthClient } from './oauthClient'

// 連携（googleConnections + oauthTokens）から GbpClient を組み立てる。プロフィール・口コミ・投稿でも使う。

const REAUTH_MESSAGE = 'Google 連携の再認証が必要です。Google 連携の設定画面で再認証してください。'

export async function createGbpClientForConnection(
  db: Firestore,
  orgId: string,
  connectionId: string,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<GbpClient> {
  const connection = await db.doc(`organizations/${orgId}/googleConnections/${connectionId}`).get()
  if (!connection.exists) fail('not-found', 'Google 連携が見つかりません。')
  if (connection.get('status') !== 'active') fail('failed-precondition', REAUTH_MESSAGE)
  const token = await db.doc(`oauthTokens/${connectionId}`).get()
  if (!token.exists) fail('failed-precondition', REAUTH_MESSAGE)

  const client = await loadOAuthClient(db, orgId)
  const refreshToken = await decryptSecret(token.get('secret') as EncryptedSecret)
  return deps.createGbpClient({ ...client, refreshToken })
}

export async function markConnectionError(db: Firestore, orgId: string, connectionId: string, message: string): Promise<void> {
  await db.doc(`organizations/${orgId}/googleConnections/${connectionId}`).update({ status: 'error', lastError: message })
}

/** GBP のエラーを画面に出せる HttpsError にする */
export function toGbpHttpsError(error: unknown): unknown {
  if (error instanceof GbpAuthError) return new HttpsError('failed-precondition', REAUTH_MESSAGE)
  if (error instanceof GbpApiError) {
    if (error.status === 429) return new HttpsError('resource-exhausted', 'Google 側の利用上限に達しました。時間をおいて再実行してください。')
    return new HttpsError('unavailable', `Google ビジネスプロフィールでエラーが発生しました: ${error.message}`)
  }
  return error
}

/** GBP を呼ぶ処理を包む。トークン失効なら連携を error にして、再認証を促すエラーにする */
export async function withConnectionErrors<T>(db: Firestore, orgId: string, connectionId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    if (error instanceof GbpAuthError) {
      await markConnectionError(db, orgId, connectionId, `Google の認証が切れました（${error.reason}）。再認証してください。`)
    }
    throw toGbpHttpsError(error)
  }
}
