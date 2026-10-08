// /admin/[orgId]/** のアクセス制御。
// ・組織のメンバーでなければ組織選択へ
// ・definePageMeta({ roles, orgTypes }) に合わなければダッシュボードへ
// auth.global.ts の後に動く（グローバルミドルウェアはファイル名順に実行される）。

export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin/')) return
  const orgId = String(to.params.orgId ?? '')
  // 本物モードでは所属組織の初回読み込みを待つ
  await useBackendReady().waitForOrgs()
  const db = useAppDb()
  const { user } = useAuth()

  const org = db.value.organizations.find(item => item.id === orgId)
  const member = db.value.members.find(item => item.orgId === orgId && item.uid === user.value?.uid)
  if (!org || !member || org.status === 'deleted') return navigateTo('/orgs')

  const isAllowed = isAllowedFor({ roles: to.meta.roles, orgTypes: to.meta.orgTypes }, member.role, org.type)
  if (!isAllowed) return navigateTo(`/admin/${orgId}`)
})
