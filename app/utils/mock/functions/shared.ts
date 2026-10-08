import type { Member, MemberRole, Organization, UsageMonthly } from '~/types/domain'
import { toMonthKey } from '../../format'
import type { MockDb } from '../seed'

// Cloud Functions のモックで共通に使う処理。
// httpsCallable のエラーコードに合わせた例外を投げ、呼び出し側の分岐を本番と同じにする。

export type FunctionsErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'already-exists'
  | 'deadline-exceeded'

export class MockFunctionsError extends Error {
  constructor(public readonly code: FunctionsErrorCode, message: string) {
    super(message)
    this.name = 'MockFunctionsError'
  }
}

export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : '処理に失敗しました。時間をおいて再度お試しください。'
}

/** ネットワーク越しの呼び出しに見せるための遅延 */
export function mockLatency(ms = 300): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function requireOrg(db: MockDb, orgId: string): Organization {
  const org = db.organizations.find(item => item.id === orgId)
  if (!org) throw new MockFunctionsError('not-found', '組織が見つかりません。')
  if (org.status !== 'active') throw new MockFunctionsError('failed-precondition', 'この組織は利用停止中です。')
  return org
}

export function requireMember(db: MockDb, orgId: string, uid: string, roles?: MemberRole[]): Member {
  const member = db.members.find(item => item.orgId === orgId && item.uid === uid)
  if (!member) throw new MockFunctionsError('permission-denied', 'この組織のメンバーではありません。')
  if (roles && !roles.includes(member.role)) throw new MockFunctionsError('permission-denied', 'この操作の権限がありません。')
  return member
}

/** staff は担当店舗だけ操作できる */
export function requireStoreAccess(member: Member, storeId: string): void {
  if (member.role === 'staff' && !member.storeIds.includes(storeId)) {
    throw new MockFunctionsError('permission-denied', '担当外の店舗です。')
  }
}

export function currentUsage(db: MockDb, orgId: string): UsageMonthly {
  const month = toMonthKey(new Date())
  let usage = db.usage.find(item => item.orgId === orgId && item.month === month)
  if (!usage) {
    usage = { orgId, month, reviewDrafts: 0, rankChecks: 0, responses: 0 }
    db.usage.push(usage)
  }
  return usage
}
