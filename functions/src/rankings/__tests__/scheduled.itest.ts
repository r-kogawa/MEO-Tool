import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { runScheduledRankCheck } from '../scheduled'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

async function seedKeyword(orgId: string, keywordId: string, isActive = true) {
  await db.doc(`organizations/${orgId}/rankKeywords/${keywordId}`).set({ orgId, storeId: 'st-1', keyword: '渋谷 カフェ', searchLocation: LOCATION, isActive })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-x', role: 'owner' }] })
})

test('runScheduledRankCheck: 有効なキーワードだけを投入し、使用回数を数える（停止中の組織は除く）', async () => {
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-a', 'kw-2')
  await seedKeyword('org-a', 'kw-off', false)
  await seedKeyword('org-stop', 'kw-s')
  const fake = createFakeRankDeps()

  const summary = await runScheduledRankCheck(db, fake.deps)

  assert.deepEqual(summary, { enqueued: 2, skippedOrgs: 0, failed: 0 })
  assert.deepEqual(fake.enqueued.map(item => item.options.id).sort(), ['org-a-kw-1-2026-10-08', 'org-a-kw-2-2026-10-08'])
  for (const { task } of fake.enqueued) {
    assert.equal(task.kind, 'keyword')
    assert.equal(task.kind === 'keyword' && task.trigger, 'scheduled')
    assert.equal(task.kind === 'keyword' && task.checkedOn, '2026-10-08')
  }
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 2)
})

test('runScheduledRankCheck: 同じ日に 2 回起動しても、使用回数とタスクは増えない', async () => {
  await seedKeyword('org-a', 'kw-1')
  const fake = createFakeRankDeps()
  await runScheduledRankCheck(db, fake.deps)
  await runScheduledRankCheck(db, fake.deps)
  assert.equal(fake.enqueued.length, 1)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)
})

test('runScheduledRankCheck: 月の上限を超える分は投入しない', async () => {
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-a', 'kw-2')
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', rankChecks: 2999 })
  const fake = createFakeRankDeps()
  const summary = await runScheduledRankCheck(db, fake.deps)
  assert.deepEqual(summary, { enqueued: 1, skippedOrgs: 1, failed: 0 })
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 3000)
})

test('runScheduledRankCheck: 1 件の投入が失敗しても残りの組織は投入され、失敗分の使用回数が戻る', async () => {
  await seedOrg(db, { orgId: 'org-b', members: [{ uid: 'u-b', role: 'owner' }] })
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-b', 'kw-2')
  await seedKeyword('org-b', 'kw-3')
  const fake = createFakeRankDeps()
  fake.failOnIds.add('org-a-kw-1-2026-10-08')

  const summary = await runScheduledRankCheck(db, fake.deps)

  assert.deepEqual(summary, { enqueued: 2, skippedOrgs: 0, failed: 1 })
  assert.deepEqual(fake.enqueued.map(item => item.options.id).sort(), ['org-b-kw-2-2026-10-08', 'org-b-kw-3-2026-10-08'])
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 0)
  assert.equal((await db.doc('organizations/org-b/usageMonthly/202610').get()).get('rankChecks'), 2)
  assert.equal((await db.doc('rankRuns/2026-10-08/orgs/org-a').get()).get('granted'), 0)
})

test('runScheduledRankCheck: 同じ日に再実行すると、失敗分だけ投入し直す', async () => {
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-a', 'kw-2')
  const fake = createFakeRankDeps()
  fake.failOnIds.add('org-a-kw-1-2026-10-08')
  await runScheduledRankCheck(db, fake.deps)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)

  fake.failOnIds.clear()
  await runScheduledRankCheck(db, fake.deps)

  assert.deepEqual(fake.enqueued.map(item => item.options.id).sort(), ['org-a-kw-1-2026-10-08', 'org-a-kw-2-2026-10-08'])
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 2)
  // さらに再実行しても増えない
  await runScheduledRankCheck(db, fake.deps)
  assert.equal(fake.enqueued.length, 2)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 2)
})
