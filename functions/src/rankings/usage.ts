import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { toJstMonthKey } from './validation'

// 今月の順位計測回数（organizations/{orgId}/usageMonthly/{YYYYMM}.rankChecks）。受け付けた時点で数える

function usageRef(db: Firestore, orgId: string, month: string) {
  return db.doc(`organizations/${orgId}/usageMonthly/${month}`)
}

/** 上限まで count 件を予約し、予約できた件数を返す。トランザクション内の読み取りの後、書き込みの前に呼ぶ */
export async function reserveRankChecks(tx: Transaction, db: Firestore, orgId: string, limit: number, count: number, now: Date): Promise<number> {
  const month = toJstMonthKey(now)
  const ref = usageRef(db, orgId, month)
  const used = ((await tx.get(ref)).get('rankChecks') as number | undefined) ?? 0
  const granted = Math.max(0, Math.min(count, limit - used))
  if (granted > 0) tx.set(ref, { orgId, month, rankChecks: FieldValue.increment(granted) }, { merge: true })
  return granted
}

/** 投入に失敗したときに予約を戻す */
export async function releaseRankChecks(db: Firestore, orgId: string, now: Date, count: number): Promise<void> {
  await usageRef(db, orgId, toJstMonthKey(now)).set({ rankChecks: FieldValue.increment(-count) }, { merge: true })
}
