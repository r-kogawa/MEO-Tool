import type { RankKeyword, RankResult, RankResultsDoc, RankSnapshot, Store } from '~/types/domain'
import { createRandom, randomInt } from './random'

// F-16 順位計測のモック。Google マップの代わりに、キーワードごとに決まった傾向の順位と上位 20 件を返す。

export const RANK_CHECK_RANGE = 20

const COMPETITOR_SUFFIXES = ['食堂', 'キッチン', 'ダイニング', '亭', 'カフェ', 'ビストロ', '屋', '茶房', 'ごはん処', 'バル', '商店', 'テラス']
const COMPETITOR_PREFIXES = ['あさひ', 'みどり', '和楽', 'はなまる', 'つばき', 'こはく', 'ひなた', 'なごみ', 'かえで', 'すずらん', 'まるや', 'いろは']
const CATEGORIES = ['定食屋', 'カフェ・喫茶', '和食店', 'レストラン', '居酒屋', 'コーヒーショップ・喫茶店']

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mockCompetitor(seed: string, rank: number): RankResult {
  const random = createRandom(hashString(`${seed}-${rank}`))
  const prefix = COMPETITOR_PREFIXES[randomInt(random, 0, COMPETITOR_PREFIXES.length - 1)]
  const suffix = COMPETITOR_SUFFIXES[randomInt(random, 0, COMPETITOR_SUFFIXES.length - 1)]
  return {
    rank,
    placeId: `mock-place-${hashString(`${seed}-${rank}`)}`,
    name: `${prefix}${suffix}`,
    rating: Math.round((3.6 + random() * 1.3) * 10) / 10,
    reviewCount: randomInt(random, 20, 900),
    category: CATEGORIES[randomInt(random, 0, CATEGORIES.length - 1)]!,
  }
}

/** 上位 20 件。rank の位置に自店を置く */
export function mockResultsFor(seed: string, store: Store | null, rank: number | null): RankResult[] {
  return Array.from({ length: RANK_CHECK_RANGE }, (_, index) => {
    const position = index + 1
    if (store && position === rank) {
      return { rank: position, placeId: store.placeId || null, name: store.name, rating: 4.3, reviewCount: 180, category: CATEGORIES[0]! }
    }
    return mockCompetitor(seed, position)
  })
}

/**
 * seed から決まる基準順位を中心に、日付ごとに揺らした順位を返す。
 * 基準が計測範囲の外側に近いものは、ときどき圏外（null）になる。
 */
export function mockRankFor(seed: string, day: string): number | null {
  const base = (hashString(seed) % 14) + 2
  // 日単位のゆるやかな波 + 小さな揺らぎで、推移グラフが自然に見えるようにする
  const dayIndex = Math.floor(Date.parse(day) / 86_400_000)
  const wave = Math.round(Math.sin((dayIndex + (hashString(seed) % 30)) / 5) * 3)
  const noise = (hashString(`${seed}${day}`) % 3) - 1
  const rank = base + wave + noise
  if (rank > RANK_CHECK_RANGE - 5 && hashString(`${seed}${day}`) % 3 === 0) return null
  return Math.min(Math.max(rank, 1), RANK_CHECK_RANGE)
}

/** 定期計測で取得エラーになる日（約 1/30）。推移グラフでエラーの日の表示を確認するため */
export function isMockErrorDay(seed: string, day: string): boolean {
  return hashString(`${seed}:error:${day}`) % 30 === 0
}

export function createMockCheck(
  keyword: RankKeyword,
  store: Store,
  day: string,
  checkedAt: string,
  trigger: RankSnapshot['trigger'],
): { snapshot: RankSnapshot; results: RankResultsDoc | null } {
  const base = { keywordId: keyword.id, storeId: keyword.storeId, checkedOn: day, checkedAt, trigger }
  if (trigger === 'scheduled' && isMockErrorDay(keyword.id, day)) {
    return { snapshot: { ...base, status: 'error', errorCode: 'blocked', rank: null, matchedBy: null, resultCount: 0 }, results: null }
  }
  const rank = mockRankFor(keyword.id, day)
  const results = mockResultsFor(keyword.id, store, rank)
  return {
    snapshot: { ...base, status: 'ok', errorCode: null, rank, matchedBy: rank === null ? null : 'placeId', resultCount: results.length },
    results: { keywordId: keyword.id, checkedOn: day, results },
  }
}
