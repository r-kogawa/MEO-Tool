import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle, type FakeGbpServer } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from '../profiles'

const db = getTestDb()
const OWNER = caller('u-owner')
let gbp: FakeGbpServer

async function addStore(id: string, locationId: string, connectionId = 'c-1') {
  await db.doc(`organizations/org-a/stores/${id}`).set({
    orgId: 'org-a', name: `店舗 ${id}`, status: 'active', connectionId,
    gbpAccountName: 'accounts/1', gbpLocationName: `locations/${locationId}`,
  })
  gbp.locations[`locations/${locationId}`] = { name: `locations/${locationId}`, title: `店舗 ${id}`, profile: { description: `説明 ${id}` } }
}

beforeEach(async () => {
  await clearFirestore()
  gbp = createFakeGbpServer()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  for (const [id, token] of [['c-1', 'r1'], ['c-2', 'r2']]) {
    await db.doc(`organizations/org-a/googleConnections/${id}`).set({ orgId: 'org-a', status: 'active', googleEmail: `${id}@example.com`, gbpAccounts: [], lastError: null })
    await db.doc(`oauthTokens/${id}`).set({ orgId: 'org-a', secret: await encryptSecret(token!) })
  }
  await addStore('st-1', '1')
  await addStore('st-2', '2')
  await db.doc('organizations/org-a/stores/st-manual').set({ orgId: 'org-a', name: '手動', status: 'active', connectionId: null })
})

test('profilesSync: 連携済みの全店舗のプロフィールを保存する（手動登録の店舗は対象外）', async () => {
  const result = await updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a' }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result, { succeeded: ['st-1', 'st-2'], failed: [] })
  const profile = (await db.doc('organizations/org-a/gbpProfiles/st-1').get()).data()!
  assert.equal(profile.storeId, 'st-1')
  assert.equal(profile.orgId, 'org-a')
  assert.equal(profile.description, '説明 st-1')
  assert.ok(profile.syncedAt)
})

test('profilesSync: staff は担当店舗のみ。担当外を指定すると permission-denied', async () => {
  const result = await updateGbpProfilesSyncFunc(db, caller('u-staff'), { orgId: 'org-a' }, createFakeGoogle({ gbp }).deps)
  assert.deepEqual(result.succeeded, ['st-1'])
  await assert.rejects(
    updateGbpProfilesSyncFunc(db, caller('u-staff'), { orgId: 'org-a', storeIds: ['st-2'] }, createFakeGoogle({ gbp }).deps),
    { code: 'permission-denied' },
  )
})

test('profilesSync: 1 店舗だけ 403・1 連携だけ失効でも、他の店舗は保存して失敗を理由付きで返す', async () => {
  await db.doc('organizations/org-a/stores/st-2').update({ connectionId: 'c-2' })
  gbp.failingNames.push('locations/1')
  const fake = createFakeGoogle({ gbp, expiredRefreshTokens: ['r2'] })
  await addStore('st-3', '3')

  const result = await updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(result.succeeded, ['st-3'])
  assert.deepEqual(result.failed.map(item => item.id), ['st-1', 'st-2'])
  assert.match(result.failed[0]!.message, /Google ビジネスプロフィールでエラー/)
  assert.match(result.failed[1]!.message, /再認証/)
  assert.equal((await db.doc('organizations/org-a/googleConnections/c-2').get()).get('status'), 'error')
})

test('profilesSync: 連携していない店舗を指定すると failed-precondition', async () => {
  await assert.rejects(
    updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a', storeIds: ['st-manual'] }, createFakeGoogle({ gbp }).deps),
    { code: 'failed-precondition', message: '店舗「手動」は Google ビジネスプロフィールと連携していません。' },
  )
})

test('updateGbpProfile: 変更項目だけを updateMask で送り、最新の内容を保存する', async () => {
  await updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: { description: '新しい説明', websiteUri: 'https://example.com' } }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(gbp.patches.map(item => [item.name, item.updateMask]), [['locations/1', 'profile.description,websiteUri']])
  const profile = (await db.doc('organizations/org-a/gbpProfiles/st-1').get()).data()!
  assert.equal(profile.description, '新しい説明')
  assert.equal(profile.websiteUri, 'https://example.com')
  const logs = await db.collection('organizations/org-a/auditLogs').where('action', '==', 'gbpProfile.update').get()
  assert.equal(logs.size, 1)
})

test('updateGbpProfile: staff は不可・入力不正は GBP を呼ばない', async () => {
  const fake = createFakeGoogle({ gbp })
  await assert.rejects(updateGbpProfileFunc(db, caller('u-staff'), { orgId: 'org-a', storeId: 'st-1', patch: { description: 'x' } }, fake.deps), { code: 'permission-denied' })
  await assert.rejects(updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: {} }, fake.deps), { code: 'invalid-argument' })
  assert.equal(gbp.patches.length, 0)
})

test('updateGbpProfile: GBP が拒否したら unavailable で理由を返す', async () => {
  gbp.failingNames.push('locations/1')
  await assert.rejects(
    updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: { description: 'x' } }, createFakeGoogle({ gbp }).deps),
    { code: 'unavailable' },
  )
})
