import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { toJstMonthKey } from '../rankings/validation'

// 今月の回答数（organizations/{orgId}/usageMonthly/{YYYYMM}.responses）。受け付けた回答を 1 件ずつ数える（月は JST）

export function addResponseUsage(tx: Transaction, db: Firestore, orgId: string, now: Date): void {
  const month = toJstMonthKey(now)
  tx.set(db.doc(`organizations/${orgId}/usageMonthly/${month}`), { orgId, month, responses: FieldValue.increment(1) }, { merge: true })
}
