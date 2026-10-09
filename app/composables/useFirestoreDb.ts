import type { MockDb } from '~/utils/mock/seed'
import { createEmptyDb } from '~/utils/firebase/emptyDb'

/** Firestore を購読して流し込む DB。書き込むのは useFirestoreSync だけで、画面は useAppDb() から読む */
export function useFirestoreDb() {
  return useState<MockDb>('firestore-db', createEmptyDb)
}
