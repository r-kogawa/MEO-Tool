import type { MemberRole, Organization, OrgType, Store } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'

// F-02 組織コンテキスト。/admin/[orgId] の orgId を正とし、ロールと組織種別で表示を出しわける。
// UI の出しわけは利便性のため。権限の最終判定は Functions（モック）側で行う。

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
}

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  individual: '個人',
  corporate: '法人',
}

export function useCurrentOrg() {
  const route = useRoute()
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()

  const orgId = computed(() => String(route.params.orgId ?? ''))
  const org = computed<Organization | null>(() => db.value.organizations.find(item => item.id === orgId.value) ?? null)
  const member = computed(() =>
    db.value.members.find(item => item.orgId === orgId.value && item.uid === user.value?.uid) ?? null)
  const role = computed<MemberRole | null>(() => member.value?.role ?? null)

  const isCorporate = computed(() => org.value?.type === 'corporate')
  const isOwner = computed(() => role.value === 'owner')
  const isStaff = computed(() => role.value === 'staff')
  /** 店舗・キーワード・連携の管理（owner / admin） */
  const canManage = computed(() => role.value === 'owner' || role.value === 'admin')
  const canManageMembers = computed(() => isCorporate.value && canManage.value)

  /** 自分が扱える店舗（staff は担当店舗のみ）。アーカイブ済みは含めない */
  const visibleStores = computed<Store[]>(() =>
    db.value.stores.filter(store =>
      store.orgId === orgId.value
      && store.status === 'active'
      && (!isStaff.value || member.value?.storeIds.includes(store.id))))
  const visibleStoreIds = computed(() => visibleStores.value.map(store => store.id))
  const hasMultipleStores = computed(() => visibleStores.value.length > 1)

  function canAccessStore(storeId: string): boolean {
    return !isStaff.value || (member.value?.storeIds.includes(storeId) ?? false)
  }

  function storeName(storeId: string): string {
    return db.value.stores.find(store => store.id === storeId)?.name ?? '（削除済みの店舗）'
  }

  /** 組織名の変更（owner のみ） */
  async function updateOrganizationName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!org.value || !isOwner.value) throw new Error('組織名を変更する権限がありません。')
    if (trimmed === '') throw new Error('組織名を入力してください。')
    if (!isMock) {
      await callFunction($functions, 'updateOrganizationName', { orgId: orgId.value, name: trimmed })
      return
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    org.value.name = trimmed
  }

  /** 管理画面内のパスを組み立てる */
  function adminPath(path = ''): string {
    return `/admin/${orgId.value}${path}`
  }

  return {
    orgId,
    org,
    member,
    role,
    isCorporate,
    isOwner,
    isStaff,
    canManage,
    canManageMembers,
    visibleStores,
    visibleStoreIds,
    hasMultipleStores,
    canAccessStore,
    storeName,
    adminPath,
    updateOrganizationName,
  }
}

/** ログインユーザーが所属する組織の一覧（組織選択・組織切替用） */
export function useMyOrganizations() {
  const db = useAppDb()
  const { user } = useAuth()
  return computed(() =>
    db.value.members
      .filter(member => member.uid === user.value?.uid)
      .map(member => ({ member, org: db.value.organizations.find(org => org.id === member.orgId)! }))
      .filter(item => item.org && item.org.status !== 'deleted'))
}
