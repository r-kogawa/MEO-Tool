import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { createRankKeywordFunc, deleteRankKeywordFunc, postRankCheckFunc, updateRankKeywordActiveFunc } from '../keywords'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }
const input = (overrides: Record<string, unknown> = {}) => ({ orgId: 'org-a', storeId: 'st-1', keyword: '渋谷　カフェ', searchLocation: LOCATION, ...overrides })
const usage = async () => (await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
})

test('createRankKeyword: 正規化して登録し、初回の手動計測を投入する', async () => {
  const fake = createFakeRankDeps()
  const created = await createRankKeywordFunc(db, OWNER, input(), fake.deps)

  assert.equal(created.keyword, '渋谷 カフェ')
  assert.equal(created.isChecking, true)
  const keyword = await db.doc(`organizations/org-a/rankKeywords/${created.id}`).get()
  assert.equal(keyword.get('keyword'), '渋谷 カフェ')
  assert.equal(keyword.get('isActive'), true)
  assert.deepEqual(keyword.get('searchLocation'), LOCATION)
  assert.ok(keyword.get('pendingCheckAt'))
  assert.equal(fake.enqueued.length, 1)
  assert.deepEqual(fake.enqueued[0]!.task, { kind: 'keyword', orgId: 'org-a', keywordId: created.id, trigger: 'manual', checkedOn: '2026-10-08' })
  assert.equal(await usage(), 1)
})

test('createRankKeyword: staff・存在しない店舗・短いキーワード・重複・上限は拒否', async () => {
  const fake = createFakeRankDeps()
  await assert.rejects(createRankKeywordFunc(db, STAFF, input(), fake.deps), { code: 'permission-denied' })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ storeId: 'st-9' }), fake.deps), { code: 'not-found' })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋' }), fake.deps), { code: 'invalid-argument' })
  await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋谷 カフェ' }), fake.deps), { code: 'already-exists' })
  // 地点が違えば別のキーワード
  await createRankKeywordFunc(db, OWNER, input({ searchLocation: { ...LOCATION, lat: 35.7 } }), fake.deps)
  await db.doc('organizations/org-a').update({ 'limits.maxKeywords': 2 })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋谷 ランチ' }), fake.deps), { code: 'resource-exhausted' })
})

test('createRankKeyword: 月の上限に達していれば登録だけして計測しない', async () => {
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', rankChecks: 3000 })
  const fake = createFakeRankDeps()
  const created = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  assert.equal(created.isChecking, false)
  assert.equal(created.checkError, 'limit')
  assert.equal(fake.enqueued.length, 0)
  assert.equal((await db.doc(`organizations/org-a/rankKeywords/${created.id}`).get()).get('pendingCheckAt'), null)
})

test('createRankKeyword: 投入に失敗したら使用回数を戻し、計測中を解除して checkError: unavailable で返す（エラーにしない）', async () => {
  const fake = createFakeRankDeps()
  fake.setEnqueueError(new Error('queue down'))
  const created = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  assert.deepEqual(created, { id: created.id, keyword: '渋谷 カフェ', isChecking: false, checkError: 'unavailable' })
  assert.equal(await usage(), 0)
  const keywords = await db.collection('organizations/org-a/rankKeywords').get()
  assert.equal(keywords.docs.length, 1)
  assert.equal(keywords.docs[0]!.get('pendingCheckAt'), null)
  // 再送は登録済みとして拒否される
  await assert.rejects(createRankKeywordFunc(db, OWNER, input(), fake.deps), { code: 'already-exists' })
})

test('postRankCheck: 投入に失敗したら使用回数を戻して unavailable', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  fake.setNow(new Date('2026-10-08T02:00:01Z'))
  fake.setEnqueueError(new Error('queue down'))
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'unavailable' })
  assert.equal(await usage(), 1)
})

test('postRankCheck: 1 時間に 1 回まで。停止中は不可。上限に達していれば不可', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'resource-exhausted', message: '手動計測は同じキーワードにつき 1 時間に 1 回までです。' })

  fake.setNow(new Date('2026-10-08T02:00:01Z'))
  await postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps)
  assert.equal(fake.enqueued.length, 2)
  assert.equal(await usage(), 2)

  await updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: false })
  fake.setNow(new Date('2026-10-08T04:00:00Z'))
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'failed-precondition' })

  await updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: true })
  await db.doc('organizations/org-a/usageMonthly/202610').update({ rankChecks: 3000 })
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'resource-exhausted', message: '今月の順位計測数の上限に達しています。' })
  await assert.rejects(postRankCheckFunc(db, STAFF, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'permission-denied' })
})

test('updateRankKeywordActive / deleteRankKeyword: owner / admin のみ。削除はスナップショットと結果も消す', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await db.doc(`organizations/org-a/rankSnapshots/${id}_2026-10-08`).set({ orgId: 'org-a', keywordId: id, storeId: 'st-1' })
  await db.doc(`organizations/org-a/rankResults/${id}_2026-10-08`).set({ orgId: 'org-a', keywordId: id, storeId: 'st-1', results: [] })
  await db.doc('organizations/org-a/rankSnapshots/other_2026-10-08').set({ orgId: 'org-a', keywordId: 'other', storeId: 'st-1' })

  await assert.rejects(updateRankKeywordActiveFunc(db, STAFF, { orgId: 'org-a', keywordId: id, isActive: false }), { code: 'permission-denied' })
  await assert.rejects(updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: 'no' }), { code: 'invalid-argument' })
  await assert.rejects(deleteRankKeywordFunc(db, STAFF, { orgId: 'org-a', keywordId: id }), { code: 'permission-denied' })
  await assert.rejects(deleteRankKeywordFunc(db, OWNER, { orgId: 'org-a', keywordId: 'none' }), { code: 'not-found' })

  await deleteRankKeywordFunc(db, OWNER, { orgId: 'org-a', keywordId: id })
  assert.equal((await db.doc(`organizations/org-a/rankKeywords/${id}`).get()).exists, false)
  assert.equal((await db.doc(`organizations/org-a/rankSnapshots/${id}_2026-10-08`).get()).exists, false)
  assert.equal((await db.doc(`organizations/org-a/rankResults/${id}_2026-10-08`).get()).exists, false)
  assert.equal((await db.doc('organizations/org-a/rankSnapshots/other_2026-10-08').get()).exists, true)
})
