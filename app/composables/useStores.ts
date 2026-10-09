import type { GbpLocationCandidate } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { createStoresFromGbpFunc, getGbpLocationsFunc, updateStoreArchiveFunc } from '~/utils/mock/functions/google'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-05 店舗の取込・管理

export function useStores() {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStores } = useCurrentOrg()

  function findStore(storeId: string) {
    return computed(() => db.value.stores.find(store => store.id === storeId && store.orgId === orgId.value) ?? null)
  }

  /** 店舗ごとの公開中アンケート数など、一覧カード用の集計 */
  function storeSummary(storeId: string) {
    const surveys = db.value.surveys.filter(survey => survey.storeId === storeId)
    return {
      publishedSurveys: surveys.filter(survey => survey.status === 'published').length,
      totalSurveys: surveys.filter(survey => survey.status !== 'closed').length,
      keywords: db.value.rankKeywords.filter(keyword => keyword.storeId === storeId).length,
      responses: db.value.responses.filter(response => response.storeId === storeId).length,
    }
  }

  async function fetchGbpCandidates(): Promise<GbpLocationCandidate[]> {
    if (!isMock.value) return callFunction($functions, 'getGbpLocations', { orgId: orgId.value })
    await mockLatency()
    return getGbpLocationsFunc(db.value, user.value!.uid, orgId.value)
  }

  /** 取り込んだ店舗の件数（length）を持つ値を返す */
  async function importStores(locationNames: string[]): Promise<{ length: number }> {
    if (!isMock.value) {
      const { storeIds } = await callFunction<object, { storeIds: string[] }>($functions, 'createStoresFromGbp', { orgId: orgId.value, locationNames })
      return storeIds
    }
    await mockLatency()
    return createStoresFromGbpFunc(db.value, user.value!.uid, orgId.value, locationNames)
  }

  async function archiveStore(storeId: string) {
    if (!isMock.value) {
      await callFunction($functions, 'updateStoreArchive', { orgId: orgId.value, storeId })
      return
    }
    await mockLatency()
    updateStoreArchiveFunc(db.value, user.value!.uid, orgId.value, storeId)
  }

  return { stores: visibleStores, findStore, storeSummary, fetchGbpCandidates, importStores, archiveStore }
}
