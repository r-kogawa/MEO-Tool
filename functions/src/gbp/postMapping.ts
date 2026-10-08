import { fail } from '../shared/errors'
import type { GbpCallToActionType, GbpDate, GbpLocalPost, GbpLocalPostInput, GbpLocalPostTopicType, GbpTimeOfDay } from '../shared/gbp'
import { asObject, requireOneOf, requireString } from '../shared/validation'

// 投稿の入力検証と GBP 形式との変換。期間は店舗の現地時刻 'YYYY-MM-DDTHH:mm'（タイムゾーン変換はしない）

export const SUMMARY_MAX = 1500
const TITLE_MAX = 58
const URL_MAX = 2048
const TOPIC_TYPES: readonly GbpLocalPostTopicType[] = ['STANDARD', 'EVENT', 'OFFER']
const ACTION_TYPES: readonly GbpCallToActionType[] = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const URL_PATTERN = /^https?:\/\/\S+$/

/** FAILED は作成に失敗した投稿（本ツール独自）。GBP の SCHEDULED などは PROCESSING にまとめる */
export type PostState = 'LIVE' | 'PROCESSING' | 'REJECTED' | 'FAILED'

export interface PostInput {
  topicType: GbpLocalPostTopicType
  summary: string
  mediaUrl: string | null
  callToAction: { actionType: GbpCallToActionType; url: string | null } | null
  event: { title: string; startAt: string; endAt: string } | null
  /** 空文字は未設定 */
  offer: { couponCode: string; redeemOnlineUrl: string; termsConditions: string } | null
}

const isBlank = (value: unknown) => value === undefined || value === null || value === ''

function optionalText(value: unknown, label: string, maxLength: number): string {
  if (isBlank(value)) return ''
  if (typeof value !== 'string') fail('invalid-argument', `${label}の値が正しくありません。`)
  const text = value.trim()
  if (text.length > maxLength) fail('invalid-argument', `${label}は ${maxLength} 文字以内にしてください。`)
  return text
}

function requireUrl(value: unknown, label: string): string {
  const url = requireString(value, label, URL_MAX)
  if (!URL_PATTERN.test(url)) fail('invalid-argument', `${label}は http:// または https:// で始まる URL を入力してください。`)
  return url
}

function parseDateTime(value: string): { date: GbpDate; time: GbpTimeOfDay } | null {
  const match = DATETIME_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day, hours, minutes] = match.slice(1).map(Number) as [number, number, number, number, number]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const isValid = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day && hours < 24 && minutes < 60
  return isValid ? { date: { year, month, day }, time: { hours, minutes } } : null
}

function requireDateTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !parseDateTime(value)) fail('invalid-argument', `${label}が正しくありません。`)
  return value
}

function readCallToAction(value: unknown, topicType: GbpLocalPostTopicType): PostInput['callToAction'] {
  if (isBlank(value)) return null
  if (topicType === 'OFFER') fail('invalid-argument', '特典の投稿にはボタンを付けられません。')
  const input = asObject(value)
  const actionType = requireOneOf(input.actionType, ACTION_TYPES, 'ボタンの種類')
  return { actionType, url: actionType === 'CALL' ? null : requireUrl(input.url, 'ボタンのリンク先') }
}

function readEvent(value: unknown, topicType: GbpLocalPostTopicType): PostInput['event'] {
  if (topicType === 'STANDARD') {
    if (!isBlank(value)) fail('invalid-argument', '最新情報にはタイトルと期間を設定できません。')
    return null
  }
  if (isBlank(value)) fail('invalid-argument', 'タイトルと期間を入力してください。')
  const input = asObject(value)
  const title = requireString(input.title, 'タイトル', TITLE_MAX)
  const startAt = requireDateTime(input.startAt, '開始日時')
  const endAt = requireDateTime(input.endAt, '終了日時')
  // 同じ形式の文字列なので辞書順で前後を比べられる
  if (endAt <= startAt) fail('invalid-argument', '終了日時は開始日時より後にしてください。')
  return { title, startAt, endAt }
}

function readOffer(value: unknown): NonNullable<PostInput['offer']> {
  const input = isBlank(value) ? {} : asObject(value)
  const redeemOnlineUrl = isBlank(input.redeemOnlineUrl) ? '' : requireUrl(input.redeemOnlineUrl, '特典のリンク先')
  return {
    couponCode: optionalText(input.couponCode, 'クーポンコード', TITLE_MAX),
    redeemOnlineUrl,
    termsConditions: optionalText(input.termsConditions, '利用規約', SUMMARY_MAX),
  }
}

/** 画面から受け取った投稿内容を検証する */
export function readPostInput(value: unknown): PostInput {
  const input = asObject(value)
  const topicType = requireOneOf(input.topicType, TOPIC_TYPES, '投稿の種類')
  return {
    topicType,
    summary: topicType === 'STANDARD' ? requireString(input.summary, '本文', SUMMARY_MAX) : optionalText(input.summary, '本文', SUMMARY_MAX),
    mediaUrl: isBlank(input.mediaUrl) ? null : requireUrl(input.mediaUrl, '画像'),
    callToAction: readCallToAction(input.callToAction, topicType),
    event: readEvent(input.event, topicType),
    offer: topicType === 'OFFER' ? readOffer(input.offer) : null,
  }
}

export function toLocalPostInput(post: PostInput): GbpLocalPostInput {
  const body: GbpLocalPostInput = { languageCode: 'ja', topicType: post.topicType }
  if (post.summary) body.summary = post.summary
  if (post.mediaUrl) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: post.mediaUrl }]
  if (post.callToAction) {
    const { actionType, url } = post.callToAction
    body.callToAction = url ? { actionType, url } : { actionType }
  }
  if (post.event) {
    const start = parseDateTime(post.event.startAt)!
    const end = parseDateTime(post.event.endAt)!
    body.event = { title: post.event.title, schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time } }
  }
  if (post.offer) {
    const offer = Object.fromEntries(Object.entries(post.offer).filter(([, value]) => value !== ''))
    if (Object.keys(offer).length > 0) body.offer = offer
  }
  return body
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 時刻の省略は、開始なら 00:00、終了なら 23:59（終日）とみなす */
function formatDateTime(date: GbpDate, time: GbpTimeOfDay | undefined, fallback: string): string {
  const clock = time ? `${pad(time.hours ?? 0)}:${pad(time.minutes ?? 0)}` : fallback
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${clock}`
}

function toPostState(state: GbpLocalPost['state']): PostState {
  if (state === 'LIVE' || state === 'REJECTED') return state
  return 'PROCESSING'
}

/** GBP の投稿を保存用の形にする。本ツールで扱わない種類（ALERT など）は null */
export function fromLocalPost(post: GbpLocalPost): (PostInput & { state: PostState; searchUrl: string | null }) | null {
  if (!TOPIC_TYPES.includes(post.topicType as GbpLocalPostTopicType)) return null
  const topicType = post.topicType as GbpLocalPostTopicType
  const schedule = post.event?.schedule
  const media = post.media?.[0]
  return {
    topicType,
    summary: post.summary ?? '',
    mediaUrl: media?.googleUrl ?? media?.sourceUrl ?? null,
    callToAction: post.callToAction ? { actionType: post.callToAction.actionType, url: post.callToAction.url ?? null } : null,
    event: post.event && schedule
      ? { title: post.event.title ?? '', startAt: formatDateTime(schedule.startDate, schedule.startTime, '00:00'), endAt: formatDateTime(schedule.endDate, schedule.endTime, '23:59') }
      : null,
    offer: topicType === 'OFFER'
      ? { couponCode: post.offer?.couponCode ?? '', redeemOnlineUrl: post.offer?.redeemOnlineUrl ?? '', termsConditions: post.offer?.termsConditions ?? '' }
      : null,
    state: toPostState(post.state),
    searchUrl: post.searchUrl ?? null,
  }
}
