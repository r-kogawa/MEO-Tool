import type { OrgLimits, OrgStatus } from '~/types/domain'
import type { MockDb } from '../seed'
import { MockFunctionsError } from './shared'

// 運営管理（docs/04-features.md F-20）。operator の Custom Claims を持つユーザーだけが呼べる。

function requireOperator(db: MockDb, uid: string): void {
  const user = db.users.find(item => item.uid === uid)
  if (!user?.isOperator) throw new MockFunctionsError('permission-denied', '運営権限がありません。')
}

export function updateOrganizationStatusFunc(db: MockDb, uid: string, orgId: string, status: Exclude<OrgStatus, 'deleted'>): void {
  requireOperator(db, uid)
  const org = db.organizations.find(item => item.id === orgId)
  if (!org) throw new MockFunctionsError('not-found', '組織が見つかりません。')
  org.status = status
  // 利用停止中は公開アンケートも止める
  for (const snapshot of db.publicSurveys.filter(item => item.orgId === orgId)) {
    const survey = db.surveys.find(item => item.id === snapshot.surveyId)
    snapshot.status = status === 'active' && survey?.status === 'published' ? 'published' : 'paused'
  }
}

export function updateOrganizationPlanFunc(db: MockDb, uid: string, orgId: string, plan: string, limits: OrgLimits): void {
  requireOperator(db, uid)
  const org = db.organizations.find(item => item.id === orgId)
  if (!org) throw new MockFunctionsError('not-found', '組織が見つかりません。')
  if (Object.values(limits).some(value => !Number.isInteger(value) || value < 0)) {
    throw new MockFunctionsError('invalid-argument', '上限値は 0 以上の整数で入力してください。')
  }
  org.plan = plan
  org.limits = { ...limits }
}
