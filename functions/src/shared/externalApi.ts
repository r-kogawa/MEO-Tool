import { createHash, timingSafeEqual } from 'node:crypto'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, onRequest } from 'firebase-functions/https'
import type { SecretParam } from 'firebase-functions/params'

// 外部システムから HTTP で呼ぶ API。JSON の POST だけを受け付け、Authorization: Bearer <API キー> で呼び出し元を確かめる。
// 応答は成功なら 200 + 結果、失敗なら { error: { code, message } }（HTTP ステータスは callable と同じ対応）

/** Bearer トークンが API キーと一致するか。キーが未設定なら常に拒否する */
export function isAuthorizedApiKey(authorization: string | undefined, apiKey: string): boolean {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
  if (!apiKey || !token) return false
  // 長さの違いで比較時間が変わらないよう、ハッシュをそろえてから比べる
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(token), digest(apiKey))
}

export function externalApi<T>(apiKey: SecretParam, handler: (db: Firestore, data: unknown) => Promise<T>) {
  return onRequest({ secrets: [apiKey] }, async (req, res) => {
    const sendError = (error: HttpsError) => {
      res.status(error.httpErrorCode.status).json({ error: { code: error.code, message: error.message } })
    }
    if (req.method !== 'POST') {
      res.set('Allow', 'POST').status(405).json({ error: { code: 'method-not-allowed', message: 'POST で送信してください。' } })
      return
    }
    if (!isAuthorizedApiKey(req.get('Authorization'), apiKey.value())) {
      return sendError(new HttpsError('unauthenticated', 'API キーが正しくありません。'))
    }
    try {
      res.status(200).json(await handler(getFirestore(), req.body))
    }
    catch (error) {
      if (error instanceof HttpsError) return sendError(error)
      logger.error('外部 API で想定外のエラー', { path: req.path, error: String(error) })
      sendError(new HttpsError('internal', 'サーバーでエラーが発生しました。'))
    }
  })
}
