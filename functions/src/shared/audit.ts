import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'

/** 監査ログを同じトランザクションで書く（本体の書き込みと一緒に確定させる） */
export function writeAuditLog(
  tx: Transaction,
  db: Firestore,
  orgId: string,
  action: string,
  actorUid: string,
  payload: Record<string, unknown> = {},
): void {
  tx.create(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
    action,
    actorUid,
    payload,
    createdAt: FieldValue.serverTimestamp(),
  })
}

/** トランザクションを使わない処理（GBP への書き込みなど）の監査ログ */
export async function addAuditLog(
  db: Firestore,
  orgId: string,
  action: string,
  actorUid: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.collection(`organizations/${orgId}/auditLogs`).add({ action, actorUid, payload, createdAt: FieldValue.serverTimestamp() })
}
