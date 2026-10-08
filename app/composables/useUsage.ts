import { toMonthKey } from '~/utils/format'

// F-19 利用量と上限

export interface UsageItem {
  label: string
  used: number
  limit: number
  unit: string
  /** 月間でリセットされるか */
  isMonthly: boolean
}

/** 上限に近いとみなす割合 */
export const USAGE_WARNING_RATIO = 0.8

export function useUsage() {
  const db = useMockDb()
  const { org, orgId } = useCurrentOrg()

  const monthly = computed(() =>
    db.value.usage.find(item => item.orgId === orgId.value && item.month === toMonthKey(new Date()))
    ?? { reviewDrafts: 0, rankChecks: 0, responses: 0 })

  const items = computed<UsageItem[]>(() => {
    if (!org.value) return []
    const limits = org.value.limits
    const count = <T extends { orgId: string }>(list: T[], predicate: (item: T) => boolean = () => true) =>
      list.filter(item => item.orgId === orgId.value && predicate(item)).length
    return [
      { label: '口コミ下書きの生成', used: monthly.value.reviewDrafts, limit: limits.monthlyReviewDrafts, unit: '回', isMonthly: true },
      { label: '順位計測', used: monthly.value.rankChecks, limit: limits.monthlyRankChecks, unit: '回', isMonthly: true },
      { label: '店舗', used: count(db.value.stores, item => item.status === 'active'), limit: limits.maxStores, unit: '店舗', isMonthly: false },
      { label: 'アンケート', used: count(db.value.surveys, item => item.status !== 'closed'), limit: limits.maxSurveys, unit: '件', isMonthly: false },
      { label: '順位キーワード', used: count(db.value.rankKeywords), limit: limits.maxKeywords, unit: '件', isMonthly: false },
      { label: 'メンバー', used: count(db.value.members), limit: limits.maxMembers, unit: '名', isMonthly: false },
    ]
  })

  /** 上限の 8 割を超えた項目（ダッシュボードの警告用） */
  const warnings = computed(() => items.value.filter(item => item.limit > 0 && item.used / item.limit >= USAGE_WARNING_RATIO))

  return { items, warnings, monthlyResponses: computed(() => monthly.value.responses) }
}
