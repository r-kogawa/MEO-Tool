import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, operatorCaller, seedOrg, seedStore } from '../../__tests__/emulator'
import { sampleContent } from '../../surveys/__tests__/sampleContent'
import { createSurveyFunc, updateSurveyPublishFunc, updateSurveyStatusFunc } from '../../surveys/surveys'
import { getOpsOrganizationFunc, getOpsOrganizationsFunc, updateOrganizationPlanFunc, updateOrganizationStatusFunc, type OpsDeps } from '../organizations'

const db = getTestDb()
const OPS = operatorCaller()
const DENIED = { code: 'permission-denied', message: '運営権限がありません。' }
// Auth の今の claims（テストに Auth Emulator は無い）。u-ops だけ運営者
const DEPS: OpsDeps = { loadClaims: async uid => (uid === 'u-ops' ? { operator: true } : {}) }
const REVOKED: OpsDeps = { loadClaims: async () => ({}) }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner', email: 'owner@example.com' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedOrg(db, { orgId: 'org-b', status: 'suspended', members: [{ uid: 'u-b', role: 'owner' }] })
  await seedOrg(db, { orgId: 'org-gone', status: 'deleted', members: [{ uid: 'u-gone', role: 'owner' }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
  // アンケートの公開には店舗の口コミ URL が要る
  await db.doc('organizations/org-a/stores/st-1').update({ reviewUrl: 'https://search.google.com/local/writereview?placeid=p-1' })
  await db.doc('organizations/org-a/stores/st-2').set({ orgId: 'org-a', name: '新宿店', status: 'archived' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ status: 'error', googleEmail: 'g@example.com', lastError: '再連携してください' })
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', responses: 3 })
})

test('getOpsOrganizations: 退会済みを除く全組織の概要を返す', async () => {
  const list = await getOpsOrganizationsFunc(db, OPS, {}, DEPS)
  assert.deepEqual(list.map(item => item.org.id).sort(), ['org-a', 'org-b'])
  const a = list.find(item => item.org.id === 'org-a')!
  assert.equal(a.ownerEmail, 'owner@example.com')
  assert.equal(a.ownerName, 'u-owner')
  assert.equal(a.stores, 1)
  assert.equal(a.members, 2)
  assert.equal(a.hasConnectionError, true)
  assert.equal(typeof a.org.createdAt, 'string')
  assert.equal(list.find(item => item.org.id === 'org-b')!.hasConnectionError, false)
})

test('getOpsOrganization: 詳細を返す。今月の利用量が無ければ null、欠けた項目は 0', async () => {
  const detail = await getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, DEPS, new Date('2026-10-18T03:00:00Z'))
  assert.deepEqual(detail.usage, { responses: 3, reviewDrafts: 0, rankChecks: 0 })
  assert.deepEqual(detail.connections, [{ id: 'c-1', googleEmail: 'g@example.com', status: 'error', lastError: '再連携してください' }])
  assert.equal(detail.memberList.length, 2)
  assert.deepEqual(detail.storeList.map(store => store.status).sort(), ['active', 'archived'])

  const nextMonth = await getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, DEPS, new Date('2026-11-01T00:00:00Z'))
  assert.equal(nextMonth.usage, null)
})

test('運営の読み取り: 運営者以外は拒否、存在しない・退会済みは not-found', async () => {
  await assert.rejects(getOpsOrganizationsFunc(db, caller('u-owner'), {}, DEPS), DENIED)
  await assert.rejects(getOpsOrganizationFunc(db, caller('u-owner'), { orgId: 'org-a' }, DEPS), DENIED)
  await assert.rejects(getOpsOrganizationFunc(db, OPS, { orgId: 'org-none' }, DEPS), { code: 'not-found', message: '組織が見つかりません。' })
  await assert.rejects(getOpsOrganizationFunc(db, OPS, { orgId: 'org-gone' }, DEPS), { code: 'not-found' })
})

const OWNER = caller('u-owner')
const LIMITS = { maxStores: 3, maxSurveys: 5, maxKeywords: 10, maxMembers: 4, monthlyReviewDrafts: 0, monthlyRankChecks: 100 }

async function publishSurvey(title: string): Promise<{ surveyId: string; slug: string }> {
  const { id } = await createSurveyFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', title, content: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, { orgId: 'org-a', surveyId: id })
  return { surveyId: id, slug: (await db.doc(`organizations/org-a/surveys/${id}`).get()).get('publicSlug') }
}
const publicStatus = async (slug: string) => (await db.doc(`publicSurveys/${slug}`).get()).get('status')
const auditActions = async () => (await db.collection('organizations/org-a/auditLogs').get()).docs.map(doc => doc.get('action') as string)

test('updateOrganizationStatus: 停止で公開アンケートを止め、再開で公開中だったものだけ戻す', async () => {
  const open = await publishSurvey('公開中')
  const paused = await publishSurvey('一時停止中')
  await updateSurveyStatusFunc(db, OWNER, { orgId: 'org-a', surveyId: paused.surveyId, action: 'pause' })

  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'suspended' }, DEPS)
  assert.equal((await db.doc('organizations/org-a').get()).get('status'), 'suspended')
  assert.equal(await publicStatus(open.slug), 'paused')
  assert.equal(await publicStatus(paused.slug), 'paused')

  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'active' }, DEPS)
  assert.equal(await publicStatus(open.slug), 'published')
  assert.equal(await publicStatus(paused.slug), 'paused')

  const logs = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'ops.updateOrganizationStatus').get()).docs.map(doc => doc.data())
  assert.equal(logs.length, 2)
  assert.ok(logs.every(log => log.actorUid === 'u-ops'))
  assert.deepEqual(logs.map(log => log.payload).sort((a, b) => a.to.localeCompare(b.to)), [{ from: 'suspended', to: 'active' }, { from: 'active', to: 'suspended' }])
})

test('updateOrganizationStatus: 同じ状態への変更は何もしない（監査ログも書かない）', async () => {
  await updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'active' }, DEPS)
  assert.deepEqual((await auditActions()).filter(action => action.startsWith('ops.')), [])
})

test('updateOrganizationPlan: プラン名と上限を変え、変更前の値を監査ログに残す。上限 0 は可', async () => {
  await updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: ' ライト ', limits: LIMITS }, DEPS)
  const org = (await db.doc('organizations/org-a').get()).data()!
  assert.equal(org.plan, 'ライト')
  assert.deepEqual(org.limits, LIMITS)
  const log = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'ops.updateOrganizationPlan').get()).docs[0]!.data()
  assert.equal(log.payload.before.plan, 'ビジネス')
  assert.deepEqual(log.payload.limits, LIMITS)
})

test('updateOrganizationPlan: 上限・プラン名の不正値を拒否する', async () => {
  const INVALID_LIMIT = { code: 'invalid-argument', message: '上限値は 0 以上の整数で入力してください。' }
  for (const bad of [-1, 1.5, '3', null]) {
    await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'ライト', limits: { ...LIMITS, maxStores: bad } }, DEPS), INVALID_LIMIT)
  }
  const { maxMembers: _omitted, ...missing } = LIMITS
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'ライト', limits: missing }, DEPS), INVALID_LIMIT)
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: '', limits: LIMITS }, DEPS), { code: 'invalid-argument', message: 'プラン名を入力してください。' })
  await updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'あ'.repeat(50), limits: LIMITS }, DEPS)
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'あ'.repeat(51), limits: LIMITS }, DEPS), { code: 'invalid-argument', message: 'プラン名は 50 文字以内にしてください。' })
})

test('運営の書き込み: 運営者以外は拒否、退会済み・存在しない組織は not-found、不正な状態は拒否', async () => {
  await assert.rejects(updateOrganizationStatusFunc(db, OWNER, { orgId: 'org-a', status: 'suspended' }, DEPS), DENIED)
  await assert.rejects(updateOrganizationPlanFunc(db, OWNER, { orgId: 'org-a', plan: 'x', limits: LIMITS }, DEPS), DENIED)
  await assert.rejects(updateOrganizationStatusFunc(db, OPS, { orgId: 'org-gone', status: 'active' }, DEPS), { code: 'not-found' })
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-none', plan: 'x', limits: LIMITS }, DEPS), { code: 'not-found' })
  await assert.rejects(updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'deleted' }, DEPS), { code: 'invalid-argument' })
  assert.equal((await db.doc('organizations/org-a').get()).get('status'), 'active')
})

test('剥奪済み: ID トークンに operator が残っていても、Auth の claims が外れていれば 4 関数とも拒否する', async () => {
  await assert.rejects(getOpsOrganizationsFunc(db, OPS, {}, REVOKED), DENIED)
  await assert.rejects(getOpsOrganizationFunc(db, OPS, { orgId: 'org-a' }, REVOKED), DENIED)
  await assert.rejects(updateOrganizationStatusFunc(db, OPS, { orgId: 'org-a', status: 'suspended' }, REVOKED), DENIED)
  await assert.rejects(updateOrganizationPlanFunc(db, OPS, { orgId: 'org-a', plan: 'x', limits: LIMITS }, REVOKED), DENIED)
  assert.equal((await db.doc('organizations/org-a').get()).get('status'), 'active')
})
