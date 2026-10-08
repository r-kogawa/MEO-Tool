import type { BatchResult, GbpProfile, GbpProfilePatch, Store } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// GBP プロフィールの一覧・同期・編集

export function useGbpProfiles() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStores } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const profiles = computed<{ store: Store; profile: GbpProfile | null }[]>(() =>
    visibleStores.value.map(store => ({ store, profile: db.value.gbpProfiles.find(item => item.storeId === store.id) ?? null })))

  function findProfile(storeId: string) {
    return computed(() => db.value.gbpProfiles.find(item => item.storeId === storeId && item.orgId === orgId.value) ?? null)
  }

  async function syncProfiles(storeIds?: string[]): Promise<BatchResult> {
    if (!isMock) return callFunction($functions, 'updateGbpProfilesSync', { orgId: orgId.value, storeIds })
    await mockLatency(600)
    return updateGbpProfilesSyncFunc(db.value, user.value!.uid, orgId.value, storeIds)
  }

  async function updateProfile(storeId: string, patch: GbpProfilePatch): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateGbpProfile', { orgId: orgId.value, storeId, patch })
      return
    }
    await mockLatency(600)
    updateGbpProfileFunc(db.value, user.value!.uid, orgId.value, storeId, patch)
  }

  return { profiles, findProfile, syncProfiles, updateProfile }
}
