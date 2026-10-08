import type { RankSearch, SearchLocation } from '~/types/domain'
import { isStaleSearch } from '~/utils/rankKeyword'
import { callFunction } from '~/utils/firebase/callFunction'
import { completeMockRankSearch, createRankSearchFunc } from '~/utils/mock/functions/rankings'
import { mockLatency } from '~/utils/mock/functions/shared'

// その場計測（キーワードを登録せずに地域 + キーワードで計測する）。owner / admin のみ

/** 古い「計測中」を取得エラーに切り替える間隔 */
const STALE_CHECK_INTERVAL_MS = 30_000

/** モックで計測にかかる時間（本番は 10 秒前後） */
const MOCK_CHECK_MS = 2000

export function useRankSearch() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  // 計測中のまま残った検索を、時間の経過で取得エラーに切り替えるための現在時刻
  const now = ref(Date.now())
  if (import.meta.client) {
    const timer = setInterval(() => { now.value = Date.now() }, STALE_CHECK_INTERVAL_MS)
    onScopeDispose(() => clearInterval(timer))
  }

  /** 直近 30 件（新しい順）。古い queued / running は timeout の取得エラーとして扱う */
  const searches = computed<RankSearch[]>(() =>
    db.value.rankSearches
      .filter(item => item.orgId === orgId.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map(item => isStaleSearch(item, now.value) ? { ...item, status: 'error' as const, errorCode: 'timeout' as const } : item))

  const currentId = ref<string | null>(null)
  const current = computed(() => searches.value.find(item => item.id === currentId.value) ?? null)

  async function startSearch(input: { keyword: string; searchLocation: SearchLocation; storeId: string | null }): Promise<void> {
    if (!isMock) {
      const { id } = await callFunction<unknown, { id: string }>($functions, 'createRankSearch', { orgId: orgId.value, ...input })
      currentId.value = id
      return
    }
    await mockLatency()
    const search = createRankSearchFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
    currentId.value = search.id
    void mockLatency(MOCK_CHECK_MS).then(() => completeMockRankSearch(db.value, search.id))
  }

  function select(searchId: string): void {
    currentId.value = searchId
  }

  return { searches, current, startSearch, select }
}
