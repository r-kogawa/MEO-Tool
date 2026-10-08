import type { BadgeTone } from '~/components/Ui/Common/Badge.vue'
import type { GbpCallToActionType, GbpDayOfWeek, GbpPostState, GbpPostTopicType, GbpRegularHoursPeriod } from '~/types/domain'

export const DAYS_OF_WEEK: GbpDayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

export const DAY_LABELS: Record<GbpDayOfWeek, string> = {
  MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日',
}

/** 一覧用の短い要約（例: 月・火・水・木・金・土 営業 / 日 定休） */
export function summarizeRegularHours(periods: GbpRegularHoursPeriod[]): string {
  if (periods.length === 0) return '営業時間 未設定'
  const openDays = DAYS_OF_WEEK.filter(day => periods.some(period => period.openDay === day))
  const closedDays = DAYS_OF_WEEK.filter(day => !openDays.includes(day))
  const open = openDays.map(day => DAY_LABELS[day]).join('・')
  return closedDays.length === 0 ? `${open} 営業` : `${open} 営業 / ${closedDays.map(day => DAY_LABELS[day]).join('・')} 定休`
}

export const TOPIC_TYPE_LABELS: Record<GbpPostTopicType, string> = { STANDARD: '最新情報', EVENT: 'イベント', OFFER: '特典' }

export const POST_STATE_LABELS: Record<GbpPostState, string> = { LIVE: '公開中', PROCESSING: '審査中', REJECTED: '却下', FAILED: '作成失敗' }

export const POST_STATE_TONES: Record<GbpPostState, BadgeTone> = { LIVE: 'success', PROCESSING: 'neutral', REJECTED: 'danger', FAILED: 'warning' }

export const CALL_TO_ACTION_LABELS: Record<GbpCallToActionType, string> = {
  BOOK: '予約', ORDER: 'オンライン注文', SHOP: '購入', LEARN_MORE: '詳細', SIGN_UP: '登録', CALL: '今すぐ電話',
}
