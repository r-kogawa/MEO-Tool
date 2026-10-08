// 本物モードで、認証状態と所属組織の初回読み込みが終わったかを持つ。ミドルウェアはこれを待ってから判定する。

interface BackendReadyState {
  isAuthReady: boolean
  isOrgsReady: boolean
}

function waitUntil(isDone: () => boolean, timeoutMs?: number): Promise<void> {
  if (isDone()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = timeoutMs
      ? setTimeout(() => {
        stop()
        reject(new Error('読み込みがタイムアウトしました。ページを再読み込みしてください。'))
      }, timeoutMs)
      : null
    const stop = watch(isDone, (value) => {
      if (!value) return
      stop()
      if (timer) clearTimeout(timer)
      resolve()
    })
  })
}

export function useBackendReady() {
  const isMock = useRuntimeConfig().public.useMock
  const state = useState<BackendReadyState>('backend-ready', () => ({ isAuthReady: isMock, isOrgsReady: isMock }))
  const db = useAppDb()

  return {
    state,
    waitForAuth: () => waitUntil(() => state.value.isAuthReady),
    waitForOrgs: () => waitUntil(() => state.value.isOrgsReady),
    /** 作成・受諾した組織が購読に届くまで待つ（直後の画面遷移でミドルウェアに弾かれないように） */
    waitForOrg: (orgId: string, timeoutMs = 10_000) =>
      waitUntil(() => db.value.organizations.some(org => org.id === orgId)
        && db.value.members.some(member => member.orgId === orgId && member.uid === db.value.users[0]?.uid), timeoutMs),
  }
}
