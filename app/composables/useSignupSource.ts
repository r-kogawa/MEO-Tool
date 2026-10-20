import type { SignupSource } from '~/types/domain'

// 広告・名刺などからの登録経路を localStorage に 30 日だけ残し、登録時に送る。
// 経路の不具合で登録を止めないため、ストレージの例外はすべて握りつぶす。

const STORAGE_KEY = 'meo-tool:signup-source'
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

const SOURCE_KEYS = ['utmSource', 'utmMedium', 'utmCampaign', 'ref', 'landingPath', 'capturedAt'] as const

const MAX_LENGTHS: Record<(typeof SOURCE_KEYS)[number], number> = {
  utmSource: MAX_VALUE_LENGTH,
  utmMedium: MAX_VALUE_LENGTH,
  utmCampaign: MAX_VALUE_LENGTH,
  ref: MAX_VALUE_LENGTH,
  landingPath: MAX_LANDING_PATH_LENGTH,
  capturedAt: MAX_CAPTURED_AT_LENGTH,
}

/** サーバーは文字列以外と上限超えを拒否するため、6 キーすべて上限内の string | null のときだけ使う */
function isSignupSource(value: unknown): value is SignupSource {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return SOURCE_KEYS.every((key) => {
    const item = record[key]
    return item === null || (typeof item === 'string' && item.length <= MAX_LENGTHS[key])
  })
}

function isExpired(source: SignupSource, now: number): boolean {
  const capturedAt = source.capturedAt ? Date.parse(source.capturedAt) : NaN
  return Number.isNaN(capturedAt) || now - capturedAt > EXPIRY_MS
}

export function useSignupSource() {
  /** 現在の URL にパラメーターがあれば保存する（後勝ち）。無ければ既存の保存は触らない */
  function capture(): void {
    const source = extractSignupSource(window.location.search, window.location.pathname, new Date())
    if (!source) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(source))
    }
    catch {
      // 保存できなければ経路なしで進める
    }
  }

  /** 期限内の経路を返す。期限切れ・壊れた値は削除して null */
  function load(): SignupSource | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const source: unknown = JSON.parse(raw)
      if (isSignupSource(source) && !isExpired(source, Date.now())) return source
    }
    catch {
      // JSON として読めない値は下で削除する
    }
    clear()
    return null
  }

  function clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    }
    catch {
      // 削除できなくても登録は成功扱い
    }
  }

  return { capture, load, clear }
}
