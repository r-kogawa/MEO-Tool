import { fail } from './errors'

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_SEPARATORS = /[\s()\-‐‑–—―−ー]/g
const PHONE_PATTERN = /^0\d{9,10}$/

export function asObject(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail('invalid-argument', 'リクエストの形式が正しくありません。')
  }
  return data as Record<string, unknown>
}

export function requireString(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim() === '') fail('invalid-argument', `${label}を入力してください。`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) fail('invalid-argument', `${label}は ${maxLength} 文字以内にしてください。`)
  return trimmed
}

/** ドキュメント ID として使う値。パス区切りなどを含めない */
export function requireId(value: unknown, label: string): string {
  const id = requireString(value, label, 128)
  if (!ID_PATTERN.test(id)) fail('invalid-argument', `${label}の形式が正しくありません。`)
  return id
}

export function requireOneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail('invalid-argument', `${label}の値が正しくありません。`)
  return value as T
}

export function requireStringArray(value: unknown, label: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item === '')) {
    fail('invalid-argument', `${label}の値が正しくありません。`)
  }
  return [...new Set(value as string[])]
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'メールアドレス', 254).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) fail('invalid-argument', 'メールアドレスの形式が正しくありません。')
  return email
}

/** 全角・区切り文字を除いた数字だけの電話番号を返す（画面側と同じ規則） */
export function requirePhone(value: unknown): string {
  const phone = requireString(value, '電話番号', 30).normalize('NFKC').replace(PHONE_SEPARATORS, '')
  if (!PHONE_PATTERN.test(phone)) fail('invalid-argument', '電話番号の形式が正しくありません。')
  return phone
}
