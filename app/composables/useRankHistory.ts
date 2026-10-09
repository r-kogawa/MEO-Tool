import { doc, getDoc } from 'firebase/firestore'
import type { RankResult, RankSnapshot } from '~/types/domain'
import { toRankResults } from '~/utils/firebase/converters'
import { errorMessageOf } from '~/utils/mock/functions/shared'
import { RANK_CHECK_RANGE } from '~/utils/mock/rank'

// F-17 1 キーワードの順位推移と、計測日の上位 20 件（競合）

export const RANK_PERIODS = [7, 30, 90] as const
export type RankPeriod = typeof RANK_PERIODS[number]

/** 計測範囲（この順位より下は圏外） */
export const RANK_RANGE = RANK_CHECK_RANGE

export function useRankHistory(keywordId: string) {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { orgId, canAccessStore, storeName } = useCurrentOrg()
  const { $db } = useNuxtApp()

  const keyword = computed(() => {
    const found = db.value.rankKeywords.find(item => item.id === keywordId && item.orgId === orgId.value)
    return found && canAccessStore(found.storeId) ? found : null
  })
  const period = ref<RankPeriod>(30)

  const history = computed<RankSnapshot[]>(() =>
    db.value.rankSnapshots
      .filter(snapshot => snapshot.keywordId === keywordId)
      .sort((a, b) => a.checkedOn.localeCompare(b.checkedOn)))

  /** 選択期間の履歴（古い順） */
  const periodHistory = computed(() => history.value.slice(-period.value))
  const latest = computed(() => history.value[history.value.length - 1] ?? null)

  const selectedDay = ref<string | null>(null)
  const selectedSnapshot = computed(() =>
    history.value.find(snapshot => snapshot.checkedOn === selectedDay.value) ?? latest.value)

  // 20 件の結果は購読せず、日付を選んだときに 1 件だけ読む（購読を軽く保つ）
  const results = ref<RankResult[]>([])
  const isLoadingResults = ref(false)
  const resultsError = ref<string | null>(null)
  let requestId = 0

  async function loadResults(day: string): Promise<RankResult[]> {
    if (isMock.value) return db.value.rankResults.find(item => item.keywordId === keywordId && item.checkedOn === day)?.results ?? []
    const snapshot = await getDoc(doc($db, `organizations/${orgId.value}/rankResults/${keywordId}_${day}`))
    return snapshot.exists() ? toRankResults(snapshot.data()).results : []
  }

  // キーワードとスナップショットは別々の購読なので、キーワードが後から届いても読み直せるよう keyword の id もキーに含める
  watch(() => (selectedSnapshot.value?.status === 'ok' && keyword.value ? `${keyword.value.id}|${selectedSnapshot.value.checkedOn}|${selectedSnapshot.value.checkedAt}` : null), async (key) => {
    const currentRequest = ++requestId
    results.value = []
    resultsError.value = null
    const day = key?.split('|')[1]
    if (!day) return
    isLoadingResults.value = true
    try {
      const loaded = await loadResults(day)
      // 読み込み中に別の日付が選ばれたら、古い結果は捨てる
      if (currentRequest === requestId) results.value = loaded
    }
    catch (error) {
      if (currentRequest === requestId) resultsError.value = errorMessageOf(error)
    }
    finally {
      if (currentRequest === requestId) isLoadingResults.value = false
    }
  }, { immediate: true })

  const bestRank = computed(() => {
    const ranks = periodHistory.value.map(item => item.rank).filter((rank): rank is number => rank !== null)
    return ranks.length > 0 ? Math.min(...ranks) : null
  })

  return {
    keyword,
    storeName: computed(() => (keyword.value ? storeName(keyword.value.storeId) : '')),
    period,
    history,
    periodHistory,
    latest,
    bestRank,
    selectedDay,
    selectedSnapshot,
    results,
    isLoadingResults,
    resultsError,
  }
}
