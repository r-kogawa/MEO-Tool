import type { MockDb } from '~/utils/mock/seed'
import { createEmptyDb } from '~/utils/firebase/emptyDb'

/**
 * 画面が読むリアクティブ DB。モックでは仮データ、本物では Firestore を購読して流し込んだもの。
 * どちらも同じ形なので、読み取り側の computed はモードを意識しない。
 */
export function useAppDb() {
  if (useRuntimeConfig().public.useMock) return useMockDb()
  return useState<MockDb>('firestore-db', createEmptyDb)
}
