// 管理画面・組織選択・運営画面は要ログイン。未ログインならログイン後に元のページへ戻す。
const PROTECTED_PREFIXES = ['/admin', '/orgs', '/ops']

export default defineNuxtRouteMiddleware(async (to) => {
  if (!PROTECTED_PREFIXES.some(prefix => to.path.startsWith(prefix))) return
  // 本物モードでは Firebase Auth の状態が確定するまで待つ（再読み込み直後は未確定）
  await useBackendReady().waitForAuth()
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
