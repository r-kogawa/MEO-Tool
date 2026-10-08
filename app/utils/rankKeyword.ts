import type { RankErrorCode, RankSearch } from '~/types/domain'

// 順位計測の入力検証と表示文言（functions/src/rankings/validation.ts と同じ規則）

export const KEYWORD_MIN_LENGTH = 2
export const KEYWORD_MAX_LENGTH = 100
/** 手動計測の「計測中」をこの時間で打ち切る（ワーカーが落ちたときに表示が残り続けないように） */
export const RANK_PENDING_TIMEOUT_MS = 10 * 60 * 1000

export const RANK_DISCLAIMER = '検索順位は検索した人の位置や端末によって変わるため、目安としてご覧ください。'

/** 全角スペースを含む空白を半角 1 つにまとめ、前後を除く */
export function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function keywordErrorOf(value: string): string | null {
  const length = normalizeKeyword(value).length
  return length < KEYWORD_MIN_LENGTH || length > KEYWORD_MAX_LENGTH
    ? `キーワードは ${KEYWORD_MIN_LENGTH}〜${KEYWORD_MAX_LENGTH} 文字で入力してください`
    : null
}

export function isPendingCheck(pendingCheckAt: string | null, now = Date.now()): boolean {
  return pendingCheckAt !== null && now - Date.parse(pendingCheckAt) < RANK_PENDING_TIMEOUT_MS
}

/** その場計測が計測中のまま RANK_PENDING_TIMEOUT_MS を過ぎた（ワーカーが結果を書けずに終わった） */
export function isStaleSearch(search: Pick<RankSearch, 'status' | 'createdAt'>, now = Date.now()): boolean {
  return (search.status === 'queued' || search.status === 'running') && now - Date.parse(search.createdAt) >= RANK_PENDING_TIMEOUT_MS
}

export function rankErrorText(code: RankErrorCode | null): string {
  if (code === 'blocked') return '取得エラー（Google マップへのアクセスが制限されました）'
  if (code === 'timeout') return '取得エラー（時間内に結果を取得できませんでした）'
  return '取得エラー'
}
