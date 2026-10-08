import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { createStoresFromGbpFunc, getGbpLocationsFunc, storeIdFromLocation, updateStoreArchiveFunc } from '../stores'

const db = getTestDb()
const OWNER = caller('u-owner')

const shibuya = {
  name: 'locations/111',
  title: '渋谷店',
  storefrontAddress: { administrativeArea: '東京都', locality: '渋谷区', addressLines: ['道玄坂1-1'] },
  latlng: { latitude: 35.65, longitude: 139.7 },
  metadata: { placeId: 'place-111' },
}
const unverified = { name: 'locations/222', title: '未確認店', metadata: {} }
const shinjuku = { ...shibuya, name: 'locations/333', title: '新宿店', metadata: { placeId: 'place-333' } }

async function addConnection(id: string, refreshToken: string, accounts = [{ name: 'accounts/1', accountName: 'A', type: null }]) {
  await db.doc(`organizations/org-a/googleConnections/${id}`).set({ orgId: 'org-a', status: 'active', googleEmail: `${id}@example.com`, gbpAccounts: accounts, lastError: null })
  await db.doc(`oauthTokens/${id}`).set({ orgId: 'org-a', secret: await encryptSecret(refreshToken) })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-111'] }],
  })
  await db.doc('organizations/org-a').update({ 'limits.maxStores': 2 })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
})

test('storeIdFromLocation: locations/123 → st-123', () => {
  assert.equal(storeIdFromLocation('locations/123'), 'st-123')
})

test('getGbpLocations: 有効な連携の全アカウントのロケーションを、取込済み・取込可否付きで返す', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, unverified] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(candidates.map(c => [c.locationName, c.title, c.isImportable, c.isImported]), [
    ['locations/111', '渋谷店', true, false],
    ['locations/222', '未確認店', false, false],
  ])
  assert.equal(candidates[0].address, '東京都渋谷区道玄坂1-1')
  assert.equal(candidates[0].accountName, 'accounts/1')
  assert.equal(candidates[0].connectionId, 'c-1')
})

test('getGbpLocations: トークンが失効した連携は error にして飛ばし、他の連携の候補は返す', async () => {
  await addConnection('c-ok', 'r-ok')
  await addConnection('c-bad', 'r-bad')
  const fake = createFakeGoogle({ locationsByRefreshToken: { 'r-ok': { 'accounts/1': [shibuya] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(candidates.map(c => c.locationName), ['locations/111'])
  assert.equal((await db.doc('organizations/org-a/googleConnections/c-bad').get()).get('status'), 'error')
})

test('getGbpLocations: staff は不可', async () => {
  await assert.rejects(getGbpLocationsFunc(db, caller('u-staff'), { orgId: 'org-a' }, createFakeGoogle().deps), { code: 'permission-denied' })
})

test('createStoresFromGbp: 選んだロケーションを店舗にする（ID・口コミ URL・位置・アカウント名）', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya] } } })

  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111'] }, fake.deps)

  assert.deepEqual(storeIds, ['st-111'])
  const store = (await db.doc('organizations/org-a/stores/st-111').get()).data()!
  assert.equal(store.name, '渋谷店')
  assert.equal(store.placeId, 'place-111')
  assert.equal(store.reviewUrl, 'https://search.google.com/local/writereview?placeid=place-111')
  assert.equal(store.gbpAccountName, 'accounts/1')
  assert.equal(store.gbpLocationName, 'locations/111')
  assert.equal(store.connectionId, 'c-1')
  assert.equal(store.location.latitude, 35.65)
  assert.equal(store.status, 'active')
})

test('createStoresFromGbp: 取込済み・取込不可・候補に無いものは無視し、2 回目で重複しない', async () => {
  await addConnection('c-1', 'r1')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, unverified] } } })
  await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111'] }, fake.deps)

  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/222', 'locations/999'] }, fake.deps)

  assert.deepEqual(storeIds, [])
  assert.equal((await db.collection('organizations/org-a/stores').get()).size, 1)
})

test('createStoresFromGbp: 上限を超える取込は全体を拒否する（ちょうどなら可）', async () => {
  await addConnection('c-1', 'r1')
  const third = { ...shibuya, name: 'locations/444', metadata: { placeId: 'place-444' } }
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya, shinjuku, third] } } })

  await assert.rejects(
    createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/333', 'locations/444'] }, fake.deps),
    { code: 'resource-exhausted', message: '店舗数の上限（2 店舗）を超えます。' },
  )
  assert.equal((await db.collection('organizations/org-a/stores').get()).size, 0)
  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111', 'locations/333'] }, fake.deps)
  assert.equal(storeIds.length, 2)
})

test('updateStoreArchive: owner / admin が店舗をアーカイブする。staff は不可', async () => {
  await db.doc('organizations/org-a/stores/st-111').set({ orgId: 'org-a', name: '渋谷店', status: 'active' })
  await assert.rejects(updateStoreArchiveFunc(db, caller('u-staff'), { orgId: 'org-a', storeId: 'st-111' }), { code: 'permission-denied' })

  await updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-111' })

  assert.equal((await db.doc('organizations/org-a/stores/st-111').get()).get('status'), 'archived')
  await assert.rejects(updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-none' }), { code: 'not-found' })
})

test('同じロケーションが 2 つの連携から見えても、候補は 1 件で、取込も 1 件だけ', async () => {
  await addConnection('c-1', 'r1')
  await addConnection('c-2', 'r2')
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': [shibuya] }, r2: { 'accounts/1': [shibuya] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)
  assert.deepEqual(candidates.map(c => c.locationName), ['locations/111'])

  const { storeIds } = await createStoresFromGbpFunc(db, OWNER, { orgId: 'org-a', locationNames: ['locations/111'] }, fake.deps)
  assert.deepEqual(storeIds, ['st-111'])
})

test('ある GBP アカウントが 403 を返しても、他のアカウント・連携の候補は返す', async () => {
  await addConnection('c-1', 'r1', [{ name: 'accounts/1', accountName: 'A', type: null }, { name: 'accounts/2', accountName: 'B', type: null }])
  const fake = createFakeGoogle({ locationsByRefreshToken: { r1: { 'accounts/1': 403, 'accounts/2': [shinjuku] } } })

  const candidates = await getGbpLocationsFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(candidates.map(c => c.locationName), ['locations/333'])
  assert.equal((await db.doc('organizations/org-a/googleConnections/c-1').get()).get('status'), 'active')
})

test('updateStoreArchive: 店舗の公開中・停止中のアンケートを終了し、公開データを消す（下書きと他店舗は変えない）', async () => {
  await db.doc('organizations/org-a/stores/st-111').set({ orgId: 'org-a', name: '渋谷店', status: 'active' })
  const surveys = [
    ['sv-published', 'st-111', 'published'],
    ['sv-paused', 'st-111', 'paused'],
    ['sv-draft', 'st-111', 'draft'],
    ['sv-other', 'st-333', 'published'],
  ] as const
  for (const [id, storeId, status] of surveys) {
    await db.doc(`organizations/org-a/surveys/${id}`).set({ orgId: 'org-a', storeId, status, publicSlug: `slug-${id}` })
    if (status !== 'draft') await db.doc(`publicSurveys/slug-${id}`).set({ orgId: 'org-a', surveyId: id, storeId, status })
  }

  await updateStoreArchiveFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-111' })

  const statusOf = async (id: string) => (await db.doc(`organizations/org-a/surveys/${id}`).get()).get('status')
  const isPublic = async (id: string) => (await db.doc(`publicSurveys/slug-${id}`).get()).exists
  assert.equal(await statusOf('sv-published'), 'closed')
  assert.equal(await statusOf('sv-paused'), 'closed')
  assert.equal(await isPublic('sv-published'), false)
  assert.equal(await isPublic('sv-paused'), false)
  assert.equal(await statusOf('sv-draft'), 'draft')
  assert.equal(await statusOf('sv-other'), 'published')
  assert.equal(await isPublic('sv-other'), true)
  const audit = (await db.collection('organizations/org-a/auditLogs').where('action', '==', 'store.archive').get()).docs[0]!
  assert.deepEqual([...audit.get('payload.closedSurveyIds')].sort(), ['sv-paused', 'sv-published'])
})
