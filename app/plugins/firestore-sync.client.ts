// 本物モードのときだけ Firestore の購読を始める（firebase.client.ts の初期化後に動く）
export default defineNuxtPlugin(() => {
  if (useRuntimeConfig().public.useMock) return
  startFirestoreSync()
})
