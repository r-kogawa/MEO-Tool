import type { RankResult } from '../types'
import type { RawGmapsItem } from './rankProvider'

/** 計測範囲（Google マップの 1 ページ目） */
export const RANK_LIMIT = 20

const PLACE_ID_PATTERN = /!19s(ChIJ[^!?&#]+)/
const RATING_PATTERN = /([\d.]+)\s*つ星/
const REVIEW_COUNT_PATTERN = /クチコミ\s*([\d,]+)\s*件/
/** 「4.1(195) · ￥1,000～2,000」「4.1」のような評価の行 */
const RATING_LINE_PATTERN = /^\d(\.\d)?\s*(\(|$)/
/** 本文の「4.4(2,123)」から件数を拾う */
const TEXT_REVIEW_COUNT_PATTERN = /^\d(?:\.\d)?\s*\(([\d,]+)\)/m

function parseRating(label: string | null): number | null {
  const match = label?.match(RATING_PATTERN)
  return match ? Number(match[1]) : null
}

function parseReviewCount(label: string | null): number | null {
  const match = label?.match(REVIEW_COUNT_PATTERN)
  return match ? Number(match[1]!.replace(/,/g, '')) : null
}

function parseReviewCountFromText(text: string): number | null {
  const match = text.match(TEXT_REVIEW_COUNT_PATTERN)
  return match ? Number(match[1]!.replace(/,/g, '')) : null
}

/** 店名・評価の行を除いた最初の行の、「·」より前の部分 */
function parseCategory(text: string, name: string): string | null {
  const line = text.split('\n')
    .map(value => value.trim())
    .find(value => value !== '' && value !== name && !RATING_LINE_PATTERN.test(value) && !value.includes('クチコミ'))
  const category = line?.split('·')[0]?.trim()
  return category ? category : null
}

/** 画面の生データを順位順の RankResult[] にする。広告・重複・店名なしを除き、上位 20 件まで */
export function parseGmapsItems(items: RawGmapsItem[]): RankResult[] {
  const seen = new Set<string>()
  const results: RankResult[] = []
  for (const item of items) {
    const name = item.name.trim()
    if (item.isSponsored || name === '') continue
    const placeId = item.href.match(PLACE_ID_PATTERN)?.[1] ?? null
    const key = placeId ?? `name:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      rank: results.length + 1,
      placeId: placeId ? decodeURIComponent(placeId) : null,
      name,
      rating: parseRating(item.starLabel),
      reviewCount: parseReviewCount(item.starLabel) ?? parseReviewCountFromText(item.text),
      category: parseCategory(item.text, name),
    })
    if (results.length === RANK_LIMIT) break
  }
  return results
}
