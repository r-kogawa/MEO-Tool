import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import type { GoogleDeps } from '../google/deps'
import { createGbpClientForConnection } from '../google/gbpClientFactory'
import { fail } from '../shared/errors'
import type { GbpClient } from '../shared/gbp'
import { requireStoreAccess, type MemberDoc } from '../shared/members'

// GBP と連携済みの店舗（connectionId・gbpAccountName・gbpLocationName を持つ有効な店舗）

export interface GbpStore {
  id: string
  name: string
  connectionId: string
  gbpAccountName: string
  gbpLocationName: string
}

function toGbpStore(id: string, data: DocumentData): GbpStore | null {
  if (data.status !== 'active' || !data.connectionId || !data.gbpAccountName || !data.gbpLocationName) return null
  return { id, name: data.name, connectionId: data.connectionId, gbpAccountName: data.gbpAccountName, gbpLocationName: data.gbpLocationName }
}

/**
 * 店舗を読み込む。storeIds を省略すると連携済みの全店舗（staff は担当店舗のみ）。
 * storeIds を指定した場合は、担当外・未連携があれば全体をエラーにする。member が null はシステム処理（自動同期）。
 */
export async function loadGbpStores(db: Firestore, orgId: string, member: MemberDoc | null, storeIds?: string[]): Promise<GbpStore[]> {
  if (!storeIds) {
    const snapshot = await db.collection(`organizations/${orgId}/stores`).where('status', '==', 'active').get()
    return snapshot.docs
      .map(doc => toGbpStore(doc.id, doc.data()))
      .filter((store): store is GbpStore => store !== null)
      .filter(store => !member || member.role !== 'staff' || member.storeIds.includes(store.id))
  }
  if (member) storeIds.forEach(id => requireStoreAccess(member, id))
  const snapshots = await Promise.all(storeIds.map(id => db.doc(`organizations/${orgId}/stores/${id}`).get()))
  return snapshots.map((snapshot) => {
    if (!snapshot.exists) fail('not-found', '店舗が見つかりません。')
    const store = toGbpStore(snapshot.id, snapshot.data()!)
    if (!store) fail('failed-precondition', `店舗「${snapshot.get('name')}」は Google ビジネスプロフィールと連携していません。`)
    return store
  })
}

/** 1 回の呼び出しの中で、連携ごとの GbpClient を使い回す */
export function createClientPool(db: Firestore, orgId: string, deps: GoogleDeps): (connectionId: string) => Promise<GbpClient> {
  const clients = new Map<string, Promise<GbpClient>>()
  return (connectionId) => {
    if (!clients.has(connectionId)) clients.set(connectionId, createGbpClientForConnection(db, orgId, connectionId, deps))
    return clients.get(connectionId)!
  }
}
