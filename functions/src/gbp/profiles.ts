import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { withConnectionErrors } from '../google/gbpClientFactory'
import { addAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import type { GbpLocation } from '../shared/gbp'
import { requireMember, requireOrg } from '../shared/members'
import { runBatch, type BatchResult } from '../shared/runBatch'
import { asObject, requireId, requireStringArray } from '../shared/validation'
import { toLocationPatch, toProfileFields } from './profileMapping'
import { createClientPool, loadGbpStores } from './storeAccess'

// プロフィールの同期・更新（店名・住所・カテゴリは表示のみ）

export const PROFILE_READ_MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile'

async function saveProfile(db: Firestore, orgId: string, storeId: string, location: GbpLocation): Promise<void> {
  await db.doc(`organizations/${orgId}/gbpProfiles/${storeId}`).set({
    orgId,
    storeId,
    ...toProfileFields(location),
    syncedAt: FieldValue.serverTimestamp(),
  })
}

function readStoreIds(value: unknown): string[] | undefined {
  return value === undefined ? undefined : requireStringArray(value, '店舗', 100)
}

export async function updateGbpProfilesSyncFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<BatchResult<string>> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  const stores = await loadGbpStores(db, orgId, member, readStoreIds(input.storeIds))
  const clientOf = createClientPool(db, orgId, deps)

  return runBatch(stores, store => store.id, store => withConnectionErrors(db, orgId, store.connectionId, async () => {
    const client = await clientOf(store.connectionId)
    await saveProfile(db, orgId, store.id, await client.getLocation(store.gbpLocationName, PROFILE_READ_MASK))
  }))
}

export async function updateGbpProfileFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  const { patch, updateMask } = toLocationPatch(input.patch)
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const [store] = await loadGbpStores(db, orgId, member, [storeId])

  await withConnectionErrors(db, orgId, store!.connectionId, async () => {
    const client = await createClientPool(db, orgId, deps)(store!.connectionId)
    await client.updateLocation(store!.gbpLocationName, patch, updateMask)
    // PATCH の応答は更新した項目に限られることがあるため、取り直して保存する
    await saveProfile(db, orgId, storeId, await client.getLocation(store!.gbpLocationName, PROFILE_READ_MASK))
  })
  await addAuditLog(db, orgId, 'gbpProfile.update', caller.uid, { storeId, updateMask })
}
