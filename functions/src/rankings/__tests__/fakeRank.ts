import type { EnqueueOptions, RankDeps } from '../rankDeps'
import type { RankResult, RankTask } from '../types'

/** 上位 count 件の結果。own を渡すとその順位に自店を置く */
export function sampleResults(count: number, own?: { rank: number; placeId: string }): RankResult[] {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1
    const isOwn = own?.rank === rank
    return { rank, placeId: isOwn ? own.placeId : `p-${rank}`, name: isOwn ? '自店' : `競合${rank}`, rating: 4, reviewCount: 10 * rank, category: 'カフェ・喫茶' }
  })
}

export function createFakeRankDeps(initial: RankResult[] | Error = []) {
  const enqueued: { task: RankTask; options: EnqueueOptions }[] = []
  const searchCalls: { keyword: string; at: { lat: number; lng: number } }[] = []
  let results = initial
  let current = new Date('2026-10-08T01:00:00Z') // JST 2026-10-08 10:00
  let enqueueError: Error | null = null
  /** 指定したタスク ID の投入だけを失敗させる */
  const failOnIds = new Set<string>()
  const deps: RankDeps = {
    provider: {
      async search(keyword, at) {
        searchCalls.push({ keyword, at })
        if (results instanceof Error) throw results
        return results
      },
    },
    async enqueue(task, options) {
      if (enqueueError) throw enqueueError
      if (failOnIds.has(options.id)) throw new Error(`enqueue failed: ${options.id}`)
      // Cloud Tasks と同じく、同じ ID の再投入は無視する
      if (enqueued.some(item => item.options.id === options.id)) return
      enqueued.push({ task, options })
    },
    now: () => current,
  }
  return {
    deps,
    enqueued,
    searchCalls,
    failOnIds,
    setResults(value: RankResult[] | Error) { results = value },
    setNow(date: Date) { current = date },
    setEnqueueError(error: Error | null) { enqueueError = error },
  }
}
