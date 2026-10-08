// 順位計測（docs/superpowers/specs/2026-10-08-rank-scraping-design.md 2 章）の型

export type RankErrorCode = 'blocked' | 'timeout' | 'parse'
export type MatchedBy = 'placeId' | 'name' | null

/** 検索結果の 1 件（1〜20 位） */
export interface RankResult {
  rank: number
  placeId: string | null
  name: string
  rating: number | null
  reviewCount: number | null
  category: string | null
}

export interface SearchLocation {
  lat: number
  lng: number
  label: string
}

/** rankCheckWorker に渡すタスク */
export type RankTask =
  | { kind: 'keyword'; orgId: string; keywordId: string; trigger: 'scheduled' | 'manual'; checkedOn: string }
  | { kind: 'search'; orgId: string; searchId: string }
