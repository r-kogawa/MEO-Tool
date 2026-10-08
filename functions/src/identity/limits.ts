import type { OrgLimits, OrgType } from '../shared/members'

// app/utils/mock/functions/identity.ts の DEFAULT_LIMITS と同じ値（料金プランは I-16 で確定予定）
export const DEFAULT_LIMITS: Record<OrgType, OrgLimits> = {
  individual: { maxStores: 1, maxSurveys: 3, maxKeywords: 5, maxMembers: 1, monthlyReviewDrafts: 100, monthlyRankChecks: 200 },
  corporate: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
}

export const PLAN_NAMES: Record<OrgType, string> = {
  individual: 'ライト',
  corporate: 'ビジネス',
}
