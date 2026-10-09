/**
 * 画面が読むリアクティブ DB。デモアカウントでログイン中は仮データ、それ以外は Firestore を購読して流し込んだもの。
 * どちらも同じ形なので、読み取り側の computed はモードを意識しない。ログインでモードが変わると自動で切り替わる。
 */
export function useAppDb() {
  const { isMock } = useDemoSession()
  const mockDb = useMockDb()
  const firestoreDb = useFirestoreDb()
  return computed(() => (isMock.value ? mockDb.value : firestoreDb.value))
}
