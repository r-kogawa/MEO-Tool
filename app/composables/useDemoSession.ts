import { isDemoUid } from '~/utils/mock/demo'

// デモアカウントでログインしているか。ログイン中だけ画面を仮データ（app/utils/mock/）で動かす。
// 状態は localStorage に残し、再読み込みしても保つ。

const STORAGE_KEY = 'meo-tool:mock-uid'

/** デモアカウント以外の uid（旧運営デモの u-ops など）が残っていたら捨てる */
function readStoredUid(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isDemoUid(stored) ? stored : null
  }
  catch {
    return null
  }
}

function writeStoredUid(uid: string | null): void {
  try {
    if (uid) localStorage.setItem(STORAGE_KEY, uid)
    else localStorage.removeItem(STORAGE_KEY)
  }
  catch {
    // ストレージが使えない環境ではメモリ上の状態だけで動かす
  }
}

export function useDemoSession() {
  const demoUid = useState<string | null>('demo-uid', readStoredUid)
  const isMock = computed(() => isDemoUid(demoUid.value))

  function enterDemo(uid: string): void {
    if (!isDemoUid(uid)) return
    demoUid.value = uid
    writeStoredUid(uid)
  }

  function leaveDemo(): void {
    demoUid.value = null
    writeStoredUid(null)
  }

  return { demoUid, isMock, enterDemo, leaveDemo }
}
