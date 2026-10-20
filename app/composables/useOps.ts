import type { GoogleConnection, Member, OrgLimits, OrgStatus, Organization, SignupProfile, Store, UsageMonthly } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { toMonthKey } from '~/utils/format'
import { updateOrganizationPlanFunc, updateOrganizationStatusFunc } from '~/utils/mock/functions/ops'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-20 運営管理（全組織の横断）。本接続は functions/src/ops/organizations.ts の callable

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  active: '利用中',
  suspended: '利用停止',
  deleted: '退会済み',
}

export type OpsOrganization = Pick<Organization, 'id' | 'type' | 'name' | 'plan' | 'status' | 'limits' | 'ownerUid' | 'createdAt'>

export interface OpsOrganizationSummary {
  org: OpsOrganization
  ownerName: string
  ownerEmail: string
  stores: number
  members: number
  hasConnectionError: boolean
  signup: SignupProfile | null
}

export interface OpsOrganizationDetail extends OpsOrganizationSummary {
  connections: Pick<GoogleConnection, 'id' | 'googleEmail' | 'status' | 'lastError'>[]
  usage: Pick<UsageMonthly, 'responses' | 'reviewDrafts' | 'rankChecks'> | null
  memberList: Pick<Member, 'uid' | 'displayName' | 'email' | 'role'>[]
  storeList: Pick<Store, 'id' | 'name' | 'address' | 'status'>[]
}

export function useOps() {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useMockDb()
  const { user } = useAuth()

  function mockSummary(org: Organization): OpsOrganizationSummary {
    const owner = db.value.users.find(item => item.uid === org.ownerUid)
    return {
      org,
      ownerName: owner?.displayName ?? '—',
      ownerEmail: owner?.email ?? '—',
      stores: db.value.stores.filter(item => item.orgId === org.id && item.status === 'active').length,
      members: db.value.members.filter(item => item.orgId === org.id).length,
      hasConnectionError: db.value.googleConnections.some(item => item.orgId === org.id && item.status === 'error'),
      signup: null,
    }
  }

  async function fetchOrganizations(): Promise<OpsOrganizationSummary[]> {
    if (!isMock.value) return callFunction($functions, 'getOpsOrganizations', {})
    await mockLatency()
    return db.value.organizations.filter(org => org.status !== 'deleted').map(mockSummary)
  }

  async function fetchOrganization(orgId: string): Promise<OpsOrganizationDetail | null> {
    if (!isMock.value) return callFunction($functions, 'getOpsOrganization', { orgId })
    await mockLatency()
    const org = db.value.organizations.find(item => item.id === orgId && item.status !== 'deleted')
    if (!org) return null
    return {
      ...mockSummary(org),
      connections: db.value.googleConnections.filter(item => item.orgId === orgId),
      usage: db.value.usage.find(item => item.orgId === orgId && item.month === toMonthKey(new Date())) ?? null,
      memberList: db.value.members.filter(item => item.orgId === orgId),
      storeList: db.value.stores.filter(item => item.orgId === orgId),
    }
  }

  async function updateStatus(orgId: string, status: Exclude<OrgStatus, 'deleted'>): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateOrganizationStatus', { orgId, status })
      return
    }
    await mockLatency()
    updateOrganizationStatusFunc(db.value, user.value!.uid, orgId, status)
  }

  async function updatePlan(orgId: string, plan: string, limits: OrgLimits): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateOrganizationPlan', { orgId, plan, limits })
      return
    }
    await mockLatency()
    updateOrganizationPlanFunc(db.value, user.value!.uid, orgId, plan, limits)
  }

  return { fetchOrganizations, fetchOrganization, updateStatus, updatePlan }
}
