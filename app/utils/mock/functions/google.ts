import type { GbpLocationCandidate, GoogleConnection, Store } from '~/types/domain'
import { createId } from '../random'
import { buildReviewUrl, type MockDb } from '../seed'
import { MockFunctionsError, requireMember, requireOrg } from './shared'

// google/ と stores/ … GBP 連携と店舗取込（docs/04-features.md F-04, F-05）
// 本番では OAuth のリダイレクトを経由するが、モックでは「許可された」扱いで即時に連携を作る。

const MOCK_LOCATIONS_FOR_NEW_CONNECTION = [
  { title: '新規連携のサンプル店舗', address: '東京都千代田区丸の内1-1-1', lat: 35.6812, lng: 139.7671 },
]

/** モックではクライアント ID だけを組織に記録する（シークレットは保持しない） */
export function updateGoogleOAuthClientFunc(db: MockDb, uid: string, orgId: string, clientId: string): void {
  const org = requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner'])
  if (!clientId.trim().endsWith('.apps.googleusercontent.com')) {
    throw new MockFunctionsError('invalid-argument', 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。')
  }
  org.googleOAuthClient = { clientId: clientId.trim(), configuredAt: new Date().toISOString() }
}

export function deleteGoogleOAuthClientFunc(db: MockDb, uid: string, orgId: string): void {
  const org = requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner'])
  if (db.googleConnections.some(item => item.orgId === orgId && item.status !== 'revoked')) {
    throw new MockFunctionsError('failed-precondition', '連携中の Google アカウントがあります。先に連携を解除してください。')
  }
  org.googleOAuthClient = null
}

export function createGoogleConnectionFunc(db: MockDb, uid: string, orgId: string, googleEmail: string): GoogleConnection {
  requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const connection: GoogleConnection = {
    id: createId('conn'),
    orgId,
    googleEmail,
    gbpAccounts: [{ name: `accounts/${Date.now()}`, accountName: googleEmail.split('@')[0] ?? googleEmail }],
    status: 'active',
    lastError: null,
    connectedAt: new Date().toISOString(),
  }
  db.googleConnections.push(connection)
  // 連携した Google アカウントで見えるロケーションを用意する
  MOCK_LOCATIONS_FOR_NEW_CONNECTION.forEach((location, index) => {
    db.gbpLocations.push({
      connectionId: connection.id,
      locationName: `locations/${connection.id}-${index}`,
      placeId: `mock-place-${connection.id}-${index}`,
      ...location,
    })
  })
  return connection
}

export function updateGoogleConnectionReauthFunc(db: MockDb, uid: string, orgId: string, connectionId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const connection = db.googleConnections.find(item => item.id === connectionId && item.orgId === orgId)
  if (!connection) throw new MockFunctionsError('not-found', '連携が見つかりません。')
  connection.status = 'active'
  connection.lastError = null
  connection.connectedAt = new Date().toISOString()
}

/** 解除しても取込済みの店舗は残す（口コミ URL は placeId だけで動くため） */
export function deleteGoogleConnectionFunc(db: MockDb, uid: string, orgId: string, connectionId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const connection = db.googleConnections.find(item => item.id === connectionId && item.orgId === orgId)
  if (!connection) throw new MockFunctionsError('not-found', '連携が見つかりません。')
  connection.status = 'revoked'
}

export function getGbpLocationsFunc(db: MockDb, uid: string, orgId: string): GbpLocationCandidate[] {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const connectionIds = db.googleConnections
    .filter(item => item.orgId === orgId && item.status === 'active')
    .map(item => item.id)
  return db.gbpLocations
    .filter(location => connectionIds.includes(location.connectionId))
    .map(location => ({
      ...location,
      isImported: db.stores.some(store => store.orgId === orgId && store.gbpLocationName === location.locationName),
      isImportable: location.placeId !== null,
    }))
}

export function createStoresFromGbpFunc(db: MockDb, uid: string, orgId: string, locationNames: string[]): Store[] {
  const org = requireOrg(db, orgId)
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const candidates = getGbpLocationsFunc(db, uid, orgId).filter(
    item => locationNames.includes(item.locationName) && item.isImportable && !item.isImported,
  )
  const activeCount = db.stores.filter(store => store.orgId === orgId && store.status === 'active').length
  if (activeCount + candidates.length > org.limits.maxStores) {
    throw new MockFunctionsError('resource-exhausted', `店舗数の上限（${org.limits.maxStores} 店舗）を超えます。`)
  }
  const created = candidates.map<Store>(location => ({
    id: createId('st'),
    orgId,
    name: location.title,
    address: location.address,
    lat: location.lat,
    lng: location.lng,
    connectionId: location.connectionId,
    gbpLocationName: location.locationName,
    placeId: location.placeId!,
    reviewUrl: buildReviewUrl(location.placeId!),
    status: 'active',
  }))
  db.stores.push(...created)
  return created
}

/** アーカイブ前に、店舗の公開中アンケートを停止する */
export function updateStoreArchiveFunc(db: MockDb, uid: string, orgId: string, storeId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const store = db.stores.find(item => item.id === storeId && item.orgId === orgId)
  if (!store) throw new MockFunctionsError('not-found', '店舗が見つかりません。')
  for (const survey of db.surveys.filter(item => item.storeId === storeId && item.status === 'published')) {
    survey.status = 'paused'
    const snapshot = db.publicSurveys.find(item => item.slug === survey.publicSlug)
    if (snapshot) snapshot.status = 'paused'
  }
  store.status = 'archived'
}
