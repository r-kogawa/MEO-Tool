// 本物モードでまだ Firebase に接続していない管理画面は、準備中ページへ移す。
// org-access.global.ts（メンバー判定）の後に動く（グローバルミドルウェアはファイル名順に実行される）。
// レイアウトでページ本体を隠すと useRoute() が更新されないため、実在するページへ移動させる。

export default defineNuxtRouteMiddleware((to) => {
  if (useRuntimeConfig().public.useMock || !to.path.startsWith('/admin/')) return
  const base = `/admin/${String(to.params.orgId ?? '')}`
  const subPath = to.path.slice(base.length)
  if (subPath === COMING_SOON_PATH || isFirebaseReadyPath(subPath)) return
  return navigateTo(`${base}${COMING_SOON_PATH}`, { replace: true })
})
