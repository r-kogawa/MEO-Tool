import type { OrgLimits, OrgStatus } from '~/types/domain'
import { toMonthKey } from '~/utils/format'
import { updateOrganizationPlanFunc, updateOrganizationStatusFunc } from '~/utils/mock/functions/ops'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-20 運営管理（全組織の横断）

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  active: '利用中',
  suspended: '利用停止',
  deleted: '退会済み',
}

export function useOps() {
  const db = useMockDb()
  const { user } = useAuth()

  const organizations = computed(() =>
    db.value.organizations.map((org) => {
      const owner = db.value.users.find(item => item.uid === org.ownerUid)
      return {
        org,
        ownerName: owner?.displayName ?? '—',
        ownerEmail: owner?.email ?? '—',
        stores: db.value.stores.filter(item => item.orgId === org.id && item.status === 'active').length,
        members: db.value.members.filter(item => item.orgId === org.id).length,
        hasConnectionError: db.value.googleConnections.some(item => item.orgId === org.id && item.status === 'error'),
      }
    }))

  function organizationDetail(orgId: string) {
    return computed(() => {
      const summary = organizations.value.find(item => item.org.id === orgId)
      if (!summary) return null
      return {
        ...summary,
        connections: db.value.googleConnections.filter(item => item.orgId === orgId),
        usage: db.value.usage.find(item => item.orgId === orgId && item.month === toMonthKey(new Date())) ?? null,
        memberList: db.value.members.filter(item => item.orgId === orgId),
        storeList: db.value.stores.filter(item => item.orgId === orgId),
      }
    })
  }

  async function updateStatus(orgId: string, status: Exclude<OrgStatus, 'deleted'>) {
    await mockLatency()
    updateOrganizationStatusFunc(db.value, user.value!.uid, orgId, status)
  }

  async function updatePlan(orgId: string, plan: string, limits: OrgLimits) {
    await mockLatency()
    updateOrganizationPlanFunc(db.value, user.value!.uid, orgId, plan, limits)
  }

  return { organizations, organizationDetail, updateStatus, updatePlan }
}
