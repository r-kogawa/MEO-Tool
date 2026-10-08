import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { onCall, type CallableOptions } from 'firebase-functions/https'
import { requireCaller, type Caller } from './auth'

export type Handler<T> = (db: Firestore, caller: Caller, data: unknown) => Promise<T>

/** ログイン不要の callable に渡す、呼び出し元の情報 */
export interface PublicContext {
  /** 接続元の IP（request.rawRequest.ip）。とれなければ null */
  ip: string | null
}

/** ログイン必須の callable。長い処理は options で timeoutSeconds を指定する */
export function callable<T>(handler: Handler<T>, options: CallableOptions = {}) {
  return onCall(options, request => handler(getFirestore(), requireCaller(request), request.data))
}

export function clientIpOf(rawRequest: { ip?: string } | undefined): string | null {
  return rawRequest?.ip || null
}

/** ログイン不要の callable（招待の確認・アンケートの回答など） */
export function publicCallable<T>(handler: (db: Firestore, data: unknown, context: PublicContext) => Promise<T>) {
  return onCall(request => handler(getFirestore(), request.data, { ip: clientIpOf(request.rawRequest) }))
}
