// 運営画面は運営フラグ（本番では Custom Claims の operator）を持つユーザーのみ。
// 存在自体を知られないよう、権限がなければ 404 にする。
export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/ops')) return
  const { user } = useAuth()
  if (!user.value?.isOperator) {
    return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page Not Found' }))
  }
})
