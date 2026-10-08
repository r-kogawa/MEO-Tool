import { createSeed, type MockDb } from '~/utils/mock/seed'

/**
 * Firebase 接続前の仮データストア。Firestore の代わりに composables から読み書きする。
 * メモリ上だけに持つため、ページを再読み込みすると初期データに戻る。
 */
export function useMockDb() {
  return useState<MockDb>('mock-db', () => createSeed())
}
