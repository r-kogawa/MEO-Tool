import type { Timestamp } from 'firebase-admin/firestore'
import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type { PublishPeriod } from './types'

// 公開期間。画面とは ISO 文字列でやり取りし、Firestore には Timestamp で保存する

type StoredDate = Timestamp | Date | null

/** Firestore から読んだ公開期間（書き込み直後の値は Date のこともある） */
export interface StoredPeriod {
  startAt: StoredDate
  endAt: StoredDate
}

/** 未指定（null / undefined）は null。それ以外は日時として読める文字列だけを受け付ける */
export function parseOptionalDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined) return null
  const date = typeof value === 'string' && value !== '' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) fail('invalid-argument', `${label}の日時の形式が正しくありません。`)
  return date
}

export function requirePublishPeriod(value: unknown): PublishPeriod {
  const input = asObject(value)
  const startAt = parseOptionalDate(input.startAt, '公開期間')
  const endAt = parseOptionalDate(input.endAt, '公開期間')
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) fail('invalid-argument', '終了日時は開始日時より後にしてください。')
  return { startAt, endAt }
}

function toDate(value: StoredDate | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : value.toDate()
}

export function toPeriod(stored: StoredPeriod | undefined): PublishPeriod {
  return { startAt: toDate(stored?.startAt), endAt: toDate(stored?.endAt) }
}

/** 開始・終了ちょうどは期間内（モックの isWithinPeriod と同じ） */
export function isWithinPeriod(period: PublishPeriod, now: Date): boolean {
  if (period.startAt && period.startAt.getTime() > now.getTime()) return false
  if (period.endAt && period.endAt.getTime() < now.getTime()) return false
  return true
}
