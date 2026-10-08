import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember } from '../shared/members'
import { asObject, requireId, requireString } from '../shared/validation'

// 口コミ返信のテンプレート（差し込みはクライアントで展開する）

const NAME_MAX = 50
const BODY_MAX = 2000

function templatesOf(db: Firestore, orgId: string) {
  return db.collection(`organizations/${orgId}/replyTemplates`)
}

function readTemplate(input: Record<string, unknown>): { name: string; body: string } {
  return { name: requireString(input.name, 'テンプレート名', NAME_MAX), body: requireString(input.body, 'テンプレートの本文', BODY_MAX) }
}

export async function createReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const template = readTemplate(input)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const ref = await templatesOf(db, orgId).add({ orgId, ...template, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  return { id: ref.id }
}

export async function updateReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const templateId = requireId(input.templateId, 'テンプレート ID')
  const template = readTemplate(input)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const ref = templatesOf(db, orgId).doc(templateId)
  if (!(await ref.get()).exists) fail('not-found', 'テンプレートが見つかりません。')
  await ref.update({ ...template, updatedAt: FieldValue.serverTimestamp() })
}

export async function deleteReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const templateId = requireId(input.templateId, 'テンプレート ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  await templatesOf(db, orgId).doc(templateId).delete()
}
