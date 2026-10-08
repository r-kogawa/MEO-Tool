import type { Firestore, WriteBatch } from 'firebase-admin/firestore'

/** batch に積む書き込み 1 件 */
export type WriteOp = (batch: WriteBatch) => void

// 1 batch の上限（500）に余裕を持たせる
const WRITE_BATCH_SIZE = 400

/** 書き込みを 400 件ずつの batch に分けて commit する */
export async function commitWrites(db: Firestore, writes: WriteOp[]): Promise<void> {
  for (let start = 0; start < writes.length; start += WRITE_BATCH_SIZE) {
    const batch = db.batch()
    writes.slice(start, start + WRITE_BATCH_SIZE).forEach(write => write(batch))
    await batch.commit()
  }
}
