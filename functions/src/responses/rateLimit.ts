import { fail } from '../shared/errors'

// 同じ接続元から同じアンケートへの回答は 10 分で 5 件まで（rateLimits/{slug}_{ipHash}.hits）

export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const RATE_LIMIT_MAX = 5
/** 最後の受付からこの時間が過ぎた rateLimits は TTL（expireAt）で消す */
export const RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000

/** 10 分より古い受付を除き、5 件以上なら拒否する。受け付けるなら今回の時刻を加えた一覧を返す */
export function nextRateLimitHits(hits: Date[], now: Date): Date[] {
  const recent = hits.filter(hit => now.getTime() - hit.getTime() <= RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) fail('resource-exhausted', '短時間に多くの回答が送られました。しばらくしてから再度お試しください。')
  return [...recent, now]
}
