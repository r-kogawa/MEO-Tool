import type { Industry, SignupSource, SignupVia, StoreCount } from '~/types/domain'

export const INDUSTRY_OPTIONS: { value: Industry; label: string }[] = [
  { value: 'salon', label: 'サロン' },
  { value: 'bodywork', label: '整体・整骨院' },
  { value: 'beauty', label: '美容' },
  { value: 'unmanned', label: '無人店舗' },
  { value: 'other', label: 'その他' },
]

export const STORE_COUNT_OPTIONS: { value: StoreCount; label: string }[] = [
  { value: '1', label: '1店舗' },
  { value: '2', label: '2店舗' },
  { value: '3-5', label: '3〜5店舗' },
  { value: '6+', label: '6店舗以上' },
]

export const INDUSTRY_LABELS: Record<Industry, string> = {
  salon: 'サロン',
  bodywork: '整体・整骨院',
  beauty: '美容',
  unmanned: '無人店舗',
  other: 'その他',
}

export const STORE_COUNT_LABELS: Record<StoreCount, string> = {
  '1': '1店舗',
  '2': '2店舗',
  '3-5': '3〜5店舗',
  '6+': '6店舗以上',
}

export const SIGNUP_VIA_LABELS: Record<SignupVia, string> = {
  signup: '新規登録画面',
  externalApi: '外部 API',
}

const PHONE_SEPARATORS = /[\s()\-‐‑–—―−ー]/g
const PHONE_PATTERN = /^0\d{9,10}$/

export const MAX_VALUE_LENGTH = 100
export const MAX_LANDING_PATH_LENGTH = 200
export const MAX_CAPTURED_AT_LENGTH = 40

/** 全角・区切り文字を除いた数字だけの電話番号にする（Functions の requirePhone と同じ規則） */
export function normalizePhone(value: string): string {
  return value.normalize('NFKC').replace(PHONE_SEPARATORS, '')
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(value))
}

/** 運営画面の「経路」列に出す短い表示。ref を優先する */
export function signupSourceLabel(source: SignupSource | null): string | null {
  return source?.ref ?? source?.utmSource ?? null
}

/** trim 後に空なら null、上限で切り詰める */
function cleanValue(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed.slice(0, max)
}

/** URL のクエリから登録経路を作る。4 つのパラメーターがすべて空なら null */
export function extractSignupSource(search: string, pathname: string, now: Date): SignupSource | null {
  const params = new URLSearchParams(search)
  const utmSource = cleanValue(params.get('utm_source'), MAX_VALUE_LENGTH)
  const utmMedium = cleanValue(params.get('utm_medium'), MAX_VALUE_LENGTH)
  const utmCampaign = cleanValue(params.get('utm_campaign'), MAX_VALUE_LENGTH)
  const ref = cleanValue(params.get('ref'), MAX_VALUE_LENGTH)
  if (!utmSource && !utmMedium && !utmCampaign && !ref) return null
  return {
    utmSource,
    utmMedium,
    utmCampaign,
    ref,
    landingPath: cleanValue(pathname, MAX_LANDING_PATH_LENGTH),
    capturedAt: cleanValue(now.toISOString(), MAX_CAPTURED_AT_LENGTH),
  }
}
