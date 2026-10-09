import type { MemberRole, OrgType } from '~/types/domain'

// サイドナビ・ボトムタブで共有するナビ項目。ロールと組織種別で表示を絞り込む。
// ページ側の definePageMeta({ roles, orgTypes }) と条件をそろえる。

export type AdminNavIcon = 'home' | 'store' | 'survey' | 'ranking' | 'settings' | 'map-pin' | 'star' | 'megaphone'

export interface AdminNavItem {
  label: string
  /** ボトムタブなど幅の狭い場所で使う短い名前 */
  shortLabel?: string
  path: string
  icon: AdminNavIcon
  roles?: MemberRole[]
  orgTypes?: OrgType[]
  /** ボトムタブ（SP）にも出す主要項目 */
  isPrimary?: boolean
}

export interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'メイン',
    items: [
      { label: 'ダッシュボード', shortLabel: 'ホーム', path: '', icon: 'home', isPrimary: true },
      { label: '店舗', path: '/stores', icon: 'store', isPrimary: true },
      { label: 'アンケート', path: '/surveys', icon: 'survey', isPrimary: true },
      { label: '検索順位', path: '/rankings', icon: 'ranking', isPrimary: true },
    ],
  },
  {
    label: 'Google ビジネス',
    items: [
      { label: 'プロフィール', path: '/profiles', icon: 'map-pin' },
      { label: '口コミ', path: '/reviews', icon: 'star' },
      { label: '投稿', path: '/posts', icon: 'megaphone' },
    ],
  },
  {
    label: '設定',
    items: [
      { label: '組織設定', path: '/settings/organization', icon: 'settings', roles: ['owner'] },
      { label: 'Google 連携', path: '/settings/google', icon: 'settings', roles: ['owner', 'admin'] },
      { label: 'メンバー', path: '/settings/members', icon: 'settings', roles: ['owner', 'admin'], orgTypes: ['corporate'] },
      { label: '利用状況', path: '/settings/usage', icon: 'settings', roles: ['owner', 'admin'] },
    ],
  },
]

export function isAllowedFor(
  rule: { roles?: MemberRole[]; orgTypes?: OrgType[] },
  role: MemberRole | null,
  orgType: OrgType | null,
): boolean {
  if (rule.roles && (!role || !rule.roles.includes(role))) return false
  if (rule.orgTypes && (!orgType || !rule.orgTypes.includes(orgType))) return false
  return true
}

export function useAdminNav() {
  const { org, role, adminPath } = useCurrentOrg()
  const route = useRoute()
  const { isWaitingForGoogle } = useGoogleRequired()

  const groups = computed(() =>
    NAV_GROUPS.map(group => ({
      label: group.label,
      items: group.items
        .filter(item => isAllowedFor(item, role.value, org.value?.type ?? null))
        .map(item => ({ ...item, to: adminPath(item.path), isGoogleUnlinked: isWaitingForGoogle.value && isGoogleRequiredPath(item.path) })),
    })).filter(group => group.items.length > 0))

  const primaryItems = computed(() => groups.value.flatMap(group => group.items).filter(item => item.isPrimary))

  function isActive(to: string): boolean {
    // ダッシュボードは完全一致、それ以外は配下のページも含める
    return to === adminPath() ? route.path === to : route.path.startsWith(to)
  }

  return { groups, primaryItems, isActive }
}
