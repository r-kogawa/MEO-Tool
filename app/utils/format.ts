const dateFormatter = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const shortDateFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })

export function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : '—'
}

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFormatter.format(new Date(iso)) : '—'
}

/** YYYY-MM-DD → 9/29 */
export function formatShortDate(day: string): string {
  return shortDateFormatter.format(new Date(`${day}T00:00:00`))
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/** ローカル時刻の YYYY-MM-DD */
export function toDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** YYYYMM */
export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
}
