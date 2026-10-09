import type { RankKeyword, RankSnapshot, SearchLocation } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import {
  createRankKeywordFunc,
  deleteRankKeywordFunc,
  postRankCheckFunc,
  updateRankKeywordActiveFunc,
} from '~/utils/mock/functions/rankings'
import { mockLatency } from '~/utils/mock/functions/shared'
import { isPendingCheck } from '~/utils/rankKeyword'

// F-15 順位キーワード管理 / F-17 一覧表示用の最新順位

export interface KeywordRow {
  keyword: RankKeyword
  storeName: string
  latest: RankSnapshot | null
  /** 前日比・前週比。正の値は順位が上がった（数字が小さくなった） */
  dayDiff: number | null
  weekDiff: number | null
  /** 直近 30 日（古い順）。圏外・取得エラーは null */
  recentRanks: (number | null)[]
  /** 直近 30 日の日付つき順位（古い順）。推移グラフ用 */
  recentPoints: { day: string; rank: number | null; isError: boolean }[]
  /** 手動計測の結果待ち */
  isChecking: boolean
}

function diff(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null) return null
  return previous - current
}

export function useRankKeywords() {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore, storeName } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const rows = computed<KeywordRow[]>(() =>
    db.value.rankKeywords
      .filter(keyword => keyword.orgId === orgId.value && canAccessStore(keyword.storeId))
      .map((keyword) => {
        const history = db.value.rankSnapshots
          .filter(snapshot => snapshot.keywordId === keyword.id)
          .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn))
        const latest = history[0] ?? null
        const recent = history.slice(0, 30).reverse()
        return {
          keyword,
          storeName: storeName(keyword.storeId),
          latest,
          dayDiff: diff(latest?.rank, history[1]?.rank),
          weekDiff: diff(latest?.rank, history[7]?.rank),
          recentRanks: recent.map(snapshot => snapshot.rank),
          recentPoints: recent.map(snapshot => ({ day: snapshot.checkedOn, rank: snapshot.rank, isError: snapshot.status === 'error' })),
          isChecking: isPendingCheck(keyword.pendingCheckAt),
        }
      })
      .sort((a, b) => a.storeName.localeCompare(b.storeName, 'ja') || a.keyword.keyword.localeCompare(b.keyword.keyword, 'ja')))

  async function createKeyword(input: { storeId: string; keyword: string; searchLocation: SearchLocation }) {
    if (!isMock.value) {
      return callFunction<unknown, { id: string; keyword: string; isChecking: boolean; checkError?: 'limit' | 'unavailable' }>($functions, 'createRankKeyword', { orgId: orgId.value, ...input })
    }
    await mockLatency(800)
    return createRankKeywordFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
  }

  async function setActive(keywordId: string, isActive: boolean) {
    if (!isMock.value) {
      await callFunction($functions, 'updateRankKeywordActive', { orgId: orgId.value, keywordId, isActive })
      return
    }
    await mockLatency()
    updateRankKeywordActiveFunc(db.value, user.value!.uid, orgId.value, keywordId, isActive)
  }

  async function deleteKeyword(keywordId: string) {
    if (!isMock.value) {
      await callFunction($functions, 'deleteRankKeyword', { orgId: orgId.value, keywordId })
      return
    }
    await mockLatency()
    deleteRankKeywordFunc(db.value, user.value!.uid, orgId.value, keywordId)
  }

  /** 本物モードは計測を受け付けるだけ（結果は購読で届く）。モックはその場で終える */
  async function checkNow(keywordId: string): Promise<'done' | 'started'> {
    if (!isMock.value) {
      await callFunction($functions, 'postRankCheck', { orgId: orgId.value, keywordId })
      return 'started'
    }
    await mockLatency(1000)
    postRankCheckFunc(db.value, user.value!.uid, orgId.value, keywordId)
    return 'done'
  }

  return { rows, createKeyword, setActive, deleteKeyword, checkNow }
}
