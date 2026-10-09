// Google ビジネスプロフィールのデータを使う画面（プロフィール・口コミ・投稿）を、Google と連携するまで連携の警告に差し替える。
// staff は Google 連携の状態を読めない（購読していない）ため対象外にして、常に画面を出す。

/** Google 連携が必要な管理画面。パスは /admin/{orgId} より後ろの部分 */
const GOOGLE_REQUIRED_PATHS = ['/profiles', '/reviews', '/posts']

export function isGoogleRequiredPath(subPath: string): boolean {
  return GOOGLE_REQUIRED_PATHS.some(path => subPath === path || subPath.startsWith(`${path}/`))
}

export function useGoogleRequired() {
  const { isMock } = useDemoSession()
  const { canManage } = useCurrentOrg()
  const { isConnected } = useGoogleConnection()

  /** Firebase で動いていて、Google と未連携の owner / admin か */
  const isWaitingForGoogle = computed(() => !isMock.value && canManage.value && !isConnected.value)

  return { isWaitingForGoogle }
}
