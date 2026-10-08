import { FieldValue, GeoPoint, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { createGbpClientForConnection, withConnectionErrors } from '../google/gbpClientFactory'
import { writeAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { GbpAuthError, type GbpLocation } from '../shared/gbp'
import { formatAddress } from '../gbp/profileMapping'
import { requireMember, requireOrg } from '../shared/members'
import { asObject, requireId, requireStringArray } from '../shared/validation'
import { publicSurveyRef, surveysOf } from '../surveys/publicSurvey'

// F-05 店舗の取込・管理

export const LOCATION_READ_MASK = 'name,title,storefrontAddress,latlng,metadata.placeId'

export interface LocationCandidate {
  connectionId: string
  accountName: string
  locationName: string
  title: string
  address: string
  placeId: string | null
  lat: number
  lng: number
  isImported: boolean
  isImportable: boolean
}

export function storeIdFromLocation(locationName: string): string {
  return `st-${locationName.replace(/^locations\//, '')}`
}

function buildReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

function toCandidate(connectionId: string, accountName: string, location: GbpLocation): Omit<LocationCandidate, 'isImported'> {
  const placeId = location.metadata?.placeId ?? null
  return {
    connectionId,
    accountName,
    locationName: location.name,
    title: location.title ?? '',
    address: formatAddress(location.storefrontAddress),
    placeId,
    lat: location.latlng?.latitude ?? 0,
    lng: location.latlng?.longitude ?? 0,
    isImportable: placeId !== null,
  }
}

/** 有効な連携ごとにロケーションを集める。トークン失効の連携は error にして飛ばす */
async function collectCandidates(db: Firestore, orgId: string, deps: GoogleDeps): Promise<LocationCandidate[]> {
  const [connections, stores] = await Promise.all([
    db.collection(`organizations/${orgId}/googleConnections`).where('status', '==', 'active').get(),
    db.collection(`organizations/${orgId}/stores`).get(),
  ])
  const importedNames = new Set(stores.docs.map(store => store.get('gbpLocationName')).filter(Boolean))
  const candidates: LocationCandidate[] = []
  for (const connection of connections.docs) {
    const accounts = (connection.get('gbpAccounts') ?? []) as { name: string }[]
    try {
      const found = await withConnectionErrors(db, orgId, connection.id, async () => {
        const client = await createGbpClientForConnection(db, orgId, connection.id, deps)
        const perAccount = await Promise.allSettled(accounts.map(async account =>
          (await client.listLocations(account.name, LOCATION_READ_MASK)).map(location => toCandidate(connection.id, account.name, location))))
        // トークン失効は連携ごと再認証が必要なので投げ直す。アカウント単位の権限エラーなどはそのアカウントだけ飛ばす
        const authFailure = perAccount.find(result => result.status === 'rejected' && result.reason instanceof GbpAuthError)
        if (authFailure?.status === 'rejected') throw authFailure.reason
        perAccount.forEach((result, index) => {
          if (result.status === 'rejected') logger.warn('GBP アカウントのロケーションを取得できませんでした', { orgId, connectionId: connection.id, account: accounts[index]?.name, error: String(result.reason) })
        })
        return perAccount.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
      })
      for (const candidate of found) {
        // 同じロケーションが複数の連携から見える場合は、最初に見つかった連携を使う
        if (candidates.some(item => item.locationName === candidate.locationName)) continue
        candidates.push({ ...candidate, isImported: importedNames.has(candidate.locationName) })
      }
    }
    catch (error) {
      // 再認証が必要な連携は画面で案内されるため、他の連携の候補は返す
      if ((error as { code?: string }).code === 'failed-precondition') {
        logger.warn('Google 連携の再認証が必要です', { orgId, connectionId: connection.id })
        continue
      }
      throw error
    }
  }
  return candidates
}

export async function getGbpLocationsFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<LocationCandidate[]> {
  const orgId = requireId(asObject(data).orgId, '組織 ID')
  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  return collectCandidates(db, orgId, deps)
}

export async function createStoresFromGbpFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<{ storeIds: string[] }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const locationNames = requireStringArray(input.locationNames, '取り込むロケーション', 100)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])

  // クライアントから受け取った値は使わず、GBP から取り直した候補だけを取り込む
  const selected = (await collectCandidates(db, orgId, deps))
    .filter(candidate => locationNames.includes(candidate.locationName) && candidate.isImportable && !candidate.isImported)

  return db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    const active = await tx.get(db.collection(`organizations/${orgId}/stores`).where('status', '==', 'active'))
    const refs = selected.map(candidate => db.doc(`organizations/${orgId}/stores/${storeIdFromLocation(candidate.locationName)}`))
    const existing = await Promise.all(refs.map(ref => tx.get(ref)))
    const toCreate = selected.filter((_, index) => !existing[index].exists)
    if (active.size + toCreate.length > org.limits.maxStores) {
      fail('resource-exhausted', `店舗数の上限（${org.limits.maxStores} 店舗）を超えます。`)
    }
    for (const candidate of toCreate) {
      tx.create(db.doc(`organizations/${orgId}/stores/${storeIdFromLocation(candidate.locationName)}`), {
        orgId,
        name: candidate.title,
        address: candidate.address,
        location: new GeoPoint(candidate.lat, candidate.lng),
        connectionId: candidate.connectionId,
        gbpAccountName: candidate.accountName,
        gbpLocationName: candidate.locationName,
        placeId: candidate.placeId,
        reviewUrl: buildReviewUrl(candidate.placeId!),
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    const storeIds = toCreate.map(candidate => storeIdFromLocation(candidate.locationName))
    if (storeIds.length > 0) writeAuditLog(tx, db, orgId, 'store.importFromGbp', caller.uid, { storeIds })
    return { storeIds }
  })
}

/** 店舗をアーカイブする。その店舗の公開中・停止中のアンケートは終了し、回答画面の公開データを消す */
export async function updateStoreArchiveFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  await db.runTransaction(async (tx) => {
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    const ref = db.doc(`organizations/${orgId}/stores/${storeId}`)
    if (!(await tx.get(ref)).exists) fail('not-found', '店舗が見つかりません。')
    const openSurveys = await tx.get(surveysOf(db, orgId).where('storeId', '==', storeId).where('status', 'in', ['published', 'paused']))
    tx.update(ref, { status: 'archived', archivedAt: FieldValue.serverTimestamp() })
    for (const survey of openSurveys.docs) {
      tx.update(survey.ref, { status: 'closed', updatedAt: FieldValue.serverTimestamp() })
      tx.delete(publicSurveyRef(db, survey.get('publicSlug')))
    }
    writeAuditLog(tx, db, orgId, 'store.archive', caller.uid, { storeId, closedSurveyIds: openSurveys.docs.map(survey => survey.id) })
  })
}
