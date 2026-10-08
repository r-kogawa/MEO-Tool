import type { MatchedBy, RankResult } from './types'

/** 店名の比較用（全角半角・空白・大文字小文字の差をなくす） */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/**
 * 自店の順位を探す。placeId を優先し、結果の placeId が取れなかったものに限って店名で照合する。
 * placeId を持つ別の店舗とは、店名が同じでも一致させない。
 */
export function matchStore(
  results: RankResult[],
  store: { placeId: string | null; name: string } | null,
): { rank: number | null; matchedBy: MatchedBy } {
  if (!store) return { rank: null, matchedBy: null }
  if (store.placeId) {
    const hit = results.find(result => result.placeId === store.placeId)
    if (hit) return { rank: hit.rank, matchedBy: 'placeId' }
  }
  const target = normalizeName(store.name)
  const byName = target === '' ? undefined : results.find(result => result.placeId === null && normalizeName(result.name) === target)
  return byName ? { rank: byName.rank, matchedBy: 'name' } : { rank: null, matchedBy: null }
}
