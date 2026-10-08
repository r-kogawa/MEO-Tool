import type { SurveyResponse } from '~/types/domain'

// F-18 ダッシュボード。本番では stores/{id}/dailyStats を読むが、モックでは回答から集計する。

export const DASHBOARD_PERIODS = [7, 30] as const
export type DashboardPeriod = typeof DASHBOARD_PERIODS[number]

export function useDashboard() {
  const db = useMockDb()
  const { orgId, visibleStores, visibleStoreIds } = useCurrentOrg()
  const { rows: keywordRows } = useRankKeywords()
  const { hasError: hasConnectionError, isConnected } = useGoogleConnection()

  const period = ref<DashboardPeriod>(30)
  /** null は全店舗 */
  const storeId = ref<string | null>(null)

  const targetStoreIds = computed(() => (storeId.value ? [storeId.value] : visibleStoreIds.value))

  function responsesInPeriod(fromDaysAgo: number, toDaysAgo: number) {
    const from = Date.now() - fromDaysAgo * 86_400_000
    const to = Date.now() - toDaysAgo * 86_400_000
    return db.value.responses.filter(item =>
      item.orgId === orgId.value
      && targetStoreIds.value.includes(item.storeId)
      && Date.parse(item.createdAt) >= from
      && Date.parse(item.createdAt) < to)
  }

  const current = computed(() => summarizeResponses(responsesInPeriod(period.value, 0)))
  /** 前の同じ長さの期間（増減の比較用） */
  const previous = computed(() => summarizeResponses(responsesInPeriod(period.value * 2, period.value)))

  /** 回答したバージョンの最初の星評価の設問を「総合評価」とみなす */
  function overallRatingOf(response: SurveyResponse): number | null {
    const version = db.value.surveyVersions.find(item => item.surveyId === response.surveyId && item.version === response.surveyVersion)
    const question = version?.content.questions.find(item => item.type === 'rating')
    const answer = question ? response.answers[question.id] : undefined
    return typeof answer === 'number' ? answer : null
  }

  const averageRating = computed(() => {
    const ratings = responsesInPeriod(period.value, 0)
      .map(overallRatingOf)
      .filter((value): value is number => value !== null)
    return ratings.length > 0 ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null
  })

  /** 法人向け: 店舗横断の比較表 */
  const storeComparison = computed(() =>
    visibleStores.value.map((store) => {
      const responses = db.value.responses.filter(item =>
        item.storeId === store.id && Date.parse(item.createdAt) >= Date.now() - period.value * 86_400_000)
      const bestKeyword = keywordRows.value
        .filter(row => row.keyword.storeId === store.id && row.keyword.isActive && row.latest?.rank != null)
        .sort((a, b) => a.latest!.rank! - b.latest!.rank!)[0]
      return { store, ...summarizeResponses(responses), bestKeyword: bestKeyword ?? null }
    }))

  const topKeywords = computed(() =>
    keywordRows.value.filter(row => row.keyword.isActive && targetStoreIds.value.includes(row.keyword.storeId)).slice(0, 5))

  const publishedSurveys = computed(() =>
    db.value.surveys.filter(item =>
      item.orgId === orgId.value && item.status === 'published' && targetStoreIds.value.includes(item.storeId)))

  return {
    period,
    storeId,
    current,
    previous,
    averageRating,
    storeComparison,
    topKeywords,
    publishedSurveys,
    hasConnectionError,
    isConnected,
  }
}
