import type { GbpStarRating } from './types'

const ACCOUNT_NAME = /^accounts\/[^/]+$/
const LOCATION_NAME = /^locations\/[^/]+$/

/**
 * v1（Business Information）のロケーション名を、v4（口コミ・投稿）のパスに変換する。
 * 例: ('accounts/1', 'locations/2') → 'accounts/1/locations/2'
 */
export function toV4LocationPath(accountName: string, locationName: string): string {
  if (!ACCOUNT_NAME.test(accountName)) throw new Error(`accountName の形式が不正です: ${accountName}`)
  if (!LOCATION_NAME.test(locationName)) throw new Error(`locationName の形式が不正です: ${locationName}`)
  return `${accountName}/${locationName}`
}

const STAR_RATINGS: Record<GbpStarRating, number | null> = {
  STAR_RATING_UNSPECIFIED: null,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

export function starRatingToNumber(rating: GbpStarRating): number | null {
  return STAR_RATINGS[rating] ?? null
}
