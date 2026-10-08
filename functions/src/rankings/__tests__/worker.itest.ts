import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { RankProviderError } from '../providers/rankProvider'
import { parseRankTask, runRankTask } from '../worker'
import { createFakeRankDeps, sampleResults } from './fakeRank'

const db = getTestDb()
const FINAL = { isFinalAttempt: true }
const NOT_FINAL = { isFinalAttempt: false }
const DAY = '2026-10-08'
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

async function seedKeyword(overrides: Record<string, unknown> = {}) {
  await db.doc('organizations/org-a/stores/st-1').set({ orgId: 'org-a', name: '自店', status: 'active', placeId: 'own-place' })
  await db.doc('organizations/org-a/rankKeywords/kw-1').set({
    orgId: 'org-a', storeId: 'st-1', keyword: '渋谷 カフェ', searchLocation: LOCATION, isActive: true,
    createdBy: 'u-owner', createdAt: new Date(), pendingCheckAt: new Date(), lastManualCheckAt: null, ...overrides,
  })
}

const keywordTask = (trigger: 'scheduled' | 'manual' = 'scheduled') => ({ kind: 'keyword' as const, orgId: 'org-a', keywordId: 'kw-1', trigger, checkedOn: DAY })
const snapshotDoc = () => db.doc(`organizations/org-a/rankSnapshots/kw-1_${DAY}`).get()
const resultsDoc = () => db.doc(`organizations/org-a/rankResults/kw-1_${DAY}`).get()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
})

test('parseRankTask: 種類ごとに検証し、不正な形は invalid-argument', () => {
  assert.deepEqual(parseRankTask(keywordTask()), keywordTask())
  assert.deepEqual(parseRankTask({ kind: 'search', orgId: 'org-a', searchId: 'rs-1' }), { kind: 'search', orgId: 'org-a', searchId: 'rs-1' })
  assert.throws(() => parseRankTask({ kind: 'x', orgId: 'org-a' }), { code: 'invalid-argument' })
  assert.throws(() => parseRankTask({ ...keywordTask(), checkedOn: '2026/10/08' }), { code: 'invalid-argument' })
})

test('runRankTask(keyword): 取得・照合してスナップショットと結果を保存し、計測中を解除する', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 3, placeId: 'own-place' }))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)

  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('rank'), 3)
  assert.equal(snapshot.get('status'), 'ok')
  assert.equal(snapshot.get('matchedBy'), 'placeId')
  assert.equal(snapshot.get('resultCount'), 20)
  assert.equal(snapshot.get('storeId'), 'st-1')
  assert.equal(snapshot.get('provider'), 'gmaps-scraper')
  assert.equal((await resultsDoc()).get('results').length, 20)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
  assert.deepEqual(fake.searchCalls, [{ keyword: '渋谷 カフェ', at: { lat: LOCATION.lat, lng: LOCATION.lng } }])
})

test('runRankTask(keyword): 同じタスクを 2 回実行してもスナップショットは 1 件', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 5, placeId: 'own-place' }))
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  const snapshots = await db.collection('organizations/org-a/rankSnapshots').get()
  assert.equal(snapshots.size, 1)
  assert.equal((await db.doc(`rankRuns/${DAY}`).get()).get('done'), 2)
})

test('runRankTask(keyword): 21 位以下・一致なしは圏外（rank: null）で ok', async () => {
  await seedKeyword()
  await runRankTask(db, keywordTask(), createFakeRankDeps(sampleResults(20)).deps, FINAL)
  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('status'), 'ok')
  assert.equal(snapshot.get('rank'), null)
})

test('runRankTask(keyword): 最後の試行でなければ例外を投げて再試行に回し、何も保存しない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(new RankProviderError('blocked', 'sorry'))
  await assert.rejects(runRankTask(db, keywordTask(), fake.deps, NOT_FINAL), { name: 'RankProviderError' })
  assert.equal((await snapshotDoc()).exists, false)
})

test('runRankTask(keyword): 最後の試行で失敗したら error を保存する（結果は書かない）', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(new RankProviderError('timeout', 'slow'))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('status'), 'error')
  assert.equal(snapshot.get('errorCode'), 'timeout')
  assert.equal(snapshot.get('rank'), null)
  assert.equal((await resultsDoc()).exists, false)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
})

test('runRankTask(keyword): 想定外の例外は parse として保存する', async () => {
  await seedKeyword()
  await runRankTask(db, keywordTask(), createFakeRankDeps(new Error('boom')).deps, FINAL)
  assert.equal((await snapshotDoc()).get('errorCode'), 'parse')
})

test('runRankTask(keyword): 同じ日の ok は error で上書きしない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 2, placeId: 'own-place' }))
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  fake.setResults(new RankProviderError('blocked', 'sorry'))
  await db.doc('organizations/org-a/rankKeywords/kw-1').update({ pendingCheckAt: new Date() })
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await snapshotDoc()).get('status'), 'ok')
  assert.equal((await snapshotDoc()).get('rank'), 2)
  assert.equal((await resultsDoc()).exists, true)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
})

test('runRankTask(keyword): キーワードが削除済み、または日次で停止中なら何もしない（キーワードを作り直さない）', async () => {
  const fake = createFakeRankDeps(sampleResults(20))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).exists, false)
  await seedKeyword({ isActive: false })
  await runRankTask(db, keywordTask('scheduled'), fake.deps, FINAL)
  assert.equal((await snapshotDoc()).exists, false)
  assert.equal(fake.searchCalls.length, 0)
})

test('runRankTask(keyword): 取得中にキーワードが削除されても、キーワードを作り直さない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps()
  fake.deps.provider = {
    async search() {
      await db.doc('organizations/org-a/rankKeywords/kw-1').delete()
      return sampleResults(20)
    },
  }
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).exists, false)
})

test('runRankTask(keyword): ブロックが続いた日は、日次のタスクを取得せずに error / blocked で終える（手動は対象外）', async () => {
  await seedKeyword()
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 5, blocked: 10 })
  const fake = createFakeRankDeps(sampleResults(20, { rank: 1, placeId: 'own-place' }))
  await runRankTask(db, keywordTask('scheduled'), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 0)
  assert.equal((await snapshotDoc()).get('errorCode'), 'blocked')
  assert.ok((await db.doc(`rankRuns/${DAY}`).get()).get('cutOffAt'))

  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 1)
  assert.equal((await snapshotDoc()).get('rank'), 1)
})

test('runRankTask(keyword): ブロックが 10 件未満、または割合が 30% 以下なら打ち切らない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20))
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 0, blocked: 9 })
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 30, blocked: 10 })
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 2)
})

test('runRankTask(search): queued → done。店舗を指定していれば自店の順位を出す', async () => {
  await db.doc('organizations/org-a/stores/st-1').set({ orgId: 'org-a', name: '自店', status: 'active', placeId: 'own-place' })
  await db.doc('organizations/org-a/rankSearches/rs-1').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: 'st-1', status: 'queued', results: [] })
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, createFakeRankDeps(sampleResults(20, { rank: 7, placeId: 'own-place' })).deps, FINAL)
  const search = await db.doc('organizations/org-a/rankSearches/rs-1').get()
  assert.equal(search.get('status'), 'done')
  assert.equal(search.get('rank'), 7)
  assert.equal(search.get('results').length, 20)
  assert.ok(search.get('finishedAt'))
})

test('runRankTask(search): 店舗なしは rank: null。完了済みは再実行しない。最後の試行の失敗は error', async () => {
  await db.doc('organizations/org-a/rankSearches/rs-1').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null, status: 'queued', results: [] })
  const fake = createFakeRankDeps(sampleResults(20))
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankSearches/rs-1').get()).get('rank'), null)
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 1)

  await db.doc('organizations/org-a/rankSearches/rs-2').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null, status: 'queued', results: [] })
  fake.setResults(new RankProviderError('blocked', 'sorry'))
  await assert.rejects(runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-2' }, fake.deps, NOT_FINAL))
  assert.equal((await db.doc('organizations/org-a/rankSearches/rs-2').get()).get('status'), 'running')
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-2' }, fake.deps, FINAL)
  const failed = await db.doc('organizations/org-a/rankSearches/rs-2').get()
  assert.equal(failed.get('status'), 'error')
  assert.equal(failed.get('errorCode'), 'blocked')
})
