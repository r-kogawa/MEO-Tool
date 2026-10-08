import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { createRankSearchFunc } from '../searches'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const OWNER = caller('u-owner')
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
})

test('createRankSearch: queued で作成し、30 日後に消える expireAt を付けて投入する', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: ' 渋谷　カフェ ', searchLocation: LOCATION, storeId: 'st-1' }, fake.deps)

  const search = await db.doc(`organizations/org-a/rankSearches/${id}`).get()
  assert.equal(search.get('status'), 'queued')
  assert.equal(search.get('keyword'), '渋谷 カフェ')
  assert.equal(search.get('storeId'), 'st-1')
  assert.equal(search.get('createdBy'), 'u-owner')
  assert.equal(search.get('expireAt').toDate().toISOString(), '2026-11-07T01:00:00.000Z')
  assert.deepEqual(fake.enqueued, [{ task: { kind: 'search', orgId: 'org-a', searchId: id }, options: { id: `search-${id}` } }])
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)
})

test('createRankSearch: 店舗は任意。staff・存在しない店舗・上限は拒否。投入失敗は error にして unavailable', async () => {
  const fake = createFakeRankDeps()
  await createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps)
  await assert.rejects(createRankSearchFunc(db, caller('u-staff'), { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'permission-denied' })
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: 'st-9' }, fake.deps), { code: 'not-found' })

  fake.setEnqueueError(new Error('queue down'))
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'unavailable' })
  const failed = (await db.collection('organizations/org-a/rankSearches').where('status', '==', 'error').get()).docs
  assert.equal(failed.length, 1)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)

  fake.setEnqueueError(null)
  await db.doc('organizations/org-a/usageMonthly/202610').update({ rankChecks: 3000 })
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'resource-exhausted' })
})
