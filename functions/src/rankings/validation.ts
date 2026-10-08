import { fail } from '../shared/errors'
import { asObject, requireString } from '../shared/validation'
import type { SearchLocation } from './types'

export const KEYWORD_MIN_LENGTH = 2
export const KEYWORD_MAX_LENGTH = 100
// 日本の範囲（離島を含む概略）
const LAT_RANGE = [20, 46] as const
const LNG_RANGE = [122, 154] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 全角スペースを含む空白を半角 1 つにまとめ、前後を除く（\s は U+3000 を含む） */
export function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function requireKeyword(value: unknown): string {
  const keyword = typeof value === 'string' ? normalizeKeyword(value) : ''
  if (keyword.length < KEYWORD_MIN_LENGTH || keyword.length > KEYWORD_MAX_LENGTH) {
    fail('invalid-argument', `キーワードは ${KEYWORD_MIN_LENGTH}〜${KEYWORD_MAX_LENGTH} 文字で入力してください。`)
  }
  return keyword
}

function isInRange(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function requireSearchLocation(value: unknown): SearchLocation {
  const input = asObject(value)
  if (!isInRange(input.lat, LAT_RANGE) || !isInRange(input.lng, LNG_RANGE)) {
    fail('invalid-argument', '検索地点は日本国内の市区町村を選んでください。')
  }
  return { lat: input.lat, lng: input.lng, label: requireString(input.label, '検索地点の名前', 50) }
}

/** JST の YYYY-MM-DD */
export function toJstDayKey(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** JST の YYYYMM */
export function toJstMonthKey(date: Date): string {
  return toJstDayKey(date).slice(0, 7).replace('-', '')
}
