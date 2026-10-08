import { fail } from '../shared/errors'
import type { GbpDate, GbpDayOfWeek, GbpLocation, GbpLocationPatch, GbpPostalAddress, GbpSpecialHourPeriod, GbpTimeOfDay, GbpTimePeriod } from '../shared/gbp'
import { asObject } from '../shared/validation'

// GBP のロケーション ⇔ 画面で扱うプロフィールの変換。時刻は 'HH:mm'、日付は 'YYYY-MM-DD'。

export const DAYS_OF_WEEK: readonly GbpDayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const DESCRIPTION_MAX = 750
const TIME_PATTERN = /^(\d{2}):(\d{2})$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const PHONE_PATTERN = /^[0-9+\-() ]{1,30}$/

export interface RegularHoursPeriod {
  openDay: GbpDayOfWeek
  openTime: string
  closeDay: GbpDayOfWeek
  closeTime: string
}

export interface SpecialHoursPeriod {
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

export interface ProfileFields {
  title: string
  address: string
  categories: string[]
  description: string
  primaryPhone: string
  websiteUri: string
  regularHours: RegularHoursPeriod[]
  specialHours: SpecialHoursPeriod[]
}

const pad = (value: number) => String(value).padStart(2, '0')

/** GBP は 00:00 を {} で返すことがある */
export function formatTime(time?: GbpTimeOfDay): string {
  return `${pad(time?.hours ?? 0)}:${pad(time?.minutes ?? 0)}`
}

export function parseTime(value: unknown, label: string): GbpTimeOfDay {
  const match = typeof value === 'string' ? TIME_PATTERN.exec(value) : null
  const hours = Number(match?.[1])
  const minutes = Number(match?.[2])
  const isValid = match !== null && minutes < 60 && (hours < 24 || (hours === 24 && minutes === 0))
  if (!isValid) fail('invalid-argument', `${label}の時刻は 00:00〜24:00 の形式で入力してください。`)
  return { hours, minutes }
}

function formatDate(date: GbpDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

function parseDate(value: unknown): GbpDate {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const isValid = match !== null && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  if (!isValid) fail('invalid-argument', '特別営業時間の日付が正しくありません。')
  return { year, month, day }
}

export function formatAddress(address?: GbpPostalAddress): string {
  if (!address) return ''
  return [address.administrativeArea, address.locality, ...(address.addressLines ?? [])].filter(Boolean).join('')
}

export function toProfileFields(location: GbpLocation): ProfileFields {
  const categories = location.categories
  return {
    title: location.title ?? '',
    address: formatAddress(location.storefrontAddress),
    categories: [categories?.primaryCategory, ...(categories?.additionalCategories ?? [])]
      .map(category => category?.displayName)
      .filter((name): name is string => Boolean(name)),
    description: location.profile?.description ?? '',
    primaryPhone: location.phoneNumbers?.primaryPhone ?? '',
    websiteUri: location.websiteUri ?? '',
    regularHours: (location.regularHours?.periods ?? []).map(period => ({
      openDay: period.openDay,
      openTime: formatTime(period.openTime),
      closeDay: period.closeDay,
      closeTime: formatTime(period.closeTime),
    })),
    specialHours: (location.specialHours?.specialHourPeriods ?? []).map(period => ({
      date: formatDate(period.startDate),
      isClosed: period.closed === true,
      openTime: period.closed ? null : formatTime(period.openTime),
      closeTime: period.closed ? null : formatTime(period.closeTime),
    })),
  }
}

function requireArray(value: unknown, label: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) fail('invalid-argument', `${label}の値が正しくありません。`)
  return value
}

function requireDay(value: unknown): GbpDayOfWeek {
  if (typeof value !== 'string' || !DAYS_OF_WEEK.includes(value as GbpDayOfWeek)) fail('invalid-argument', '曜日の値が正しくありません。')
  return value as GbpDayOfWeek
}

function toRegularPeriod(value: unknown): GbpTimePeriod {
  const period = asObject(value)
  return {
    openDay: requireDay(period.openDay),
    openTime: parseTime(period.openTime, '開店'),
    closeDay: requireDay(period.closeDay),
    closeTime: parseTime(period.closeTime, '閉店'),
  }
}

function nextDate(date: GbpDate): GbpDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

function minutesOf(time: GbpTimeOfDay): number {
  return (time.hours ?? 0) * 60 + (time.minutes ?? 0)
}

function toSpecialPeriod(value: unknown): GbpSpecialHourPeriod {
  const period = asObject(value)
  const date = parseDate(period.date)
  if (period.isClosed === true) return { startDate: date, endDate: date, closed: true }
  const openTime = parseTime(period.openTime, '開店')
  const closeTime = parseTime(period.closeTime, '閉店')
  // 閉店が開店以前なら日をまたぐ営業（GBP は endDate を翌日にする必要がある）
  const endDate = minutesOf(closeTime) <= minutesOf(openTime) ? nextDate(date) : date
  return { startDate: date, endDate, openTime, closeTime }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') fail('invalid-argument', `${label}の値が正しくありません。`)
  return value.trim()
}

/** 画面から受け取った変更内容を検証し、GBP の PATCH 内容と updateMask にする */
export function toLocationPatch(input: unknown): { patch: GbpLocationPatch; updateMask: string[] } {
  const data = asObject(input)
  const patch: GbpLocationPatch = {}
  const updateMask: string[] = []

  if (data.description !== undefined) {
    const description = requireText(data.description, '説明')
    if (description.length > DESCRIPTION_MAX) fail('invalid-argument', `説明は ${DESCRIPTION_MAX} 文字以内にしてください。`)
    patch.profile = { description }
    updateMask.push('profile.description')
  }
  if (data.primaryPhone !== undefined) {
    const primaryPhone = requireText(data.primaryPhone, '電話番号')
    if (primaryPhone !== '' && !PHONE_PATTERN.test(primaryPhone)) fail('invalid-argument', '電話番号の形式が正しくありません。')
    patch.phoneNumbers = { primaryPhone }
    updateMask.push('phoneNumbers.primaryPhone')
  }
  if (data.websiteUri !== undefined) {
    const websiteUri = requireText(data.websiteUri, 'ウェブサイト')
    if (websiteUri !== '' && !/^https?:\/\/\S+$/.test(websiteUri)) {
      fail('invalid-argument', 'ウェブサイトは http:// または https:// で始まる URL を入力してください。')
    }
    patch.websiteUri = websiteUri
    updateMask.push('websiteUri')
  }
  if (data.regularHours !== undefined) {
    patch.regularHours = { periods: requireArray(data.regularHours, '営業時間', 50).map(toRegularPeriod) }
    updateMask.push('regularHours')
  }
  if (data.specialHours !== undefined) {
    patch.specialHours = { specialHourPeriods: requireArray(data.specialHours, '特別営業時間', 100).map(toSpecialPeriod) }
    updateMask.push('specialHours')
  }
  if (updateMask.length === 0) fail('invalid-argument', '変更する項目がありません。')
  return { patch, updateMask }
}
