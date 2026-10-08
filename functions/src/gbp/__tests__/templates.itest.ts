import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { runScheduledReviewsSync } from '../reviews'
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from '../templates'

const db = getTestDb()
const OWNER = caller('u-owner')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
})

test('replyTemplate: owner / admin が作成・更新・削除できる', async () => {
  const { id } = await createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: ' お礼 ', body: '{投稿者名}様、ありがとうございます。' })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).get('name'), 'お礼')

  await updateReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id, name: 'お礼（改）', body: '本文' })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).get('body'), '本文')

  await deleteReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).exists, false)
})

test('replyTemplate: staff は不可、空・長すぎる本文、存在しないテンプレートは拒否', async () => {
  await assert.rejects(createReplyTemplateFunc(db, caller('u-staff'), { orgId: 'org-a', name: 'x', body: 'y' }), { code: 'permission-denied' })
  await assert.rejects(createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'x', body: '' }), { code: 'invalid-argument' })
  await assert.rejects(createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'x', body: 'a'.repeat(2001) }), { code: 'invalid-argument' })
  await assert.rejects(updateReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: 'none', name: 'x', body: 'y' }), { code: 'not-found' })
})

test('runScheduledReviewsSync: 連携中の組織の全店舗の口コミを同期する（停止中の組織は除く）', async () => {
  const gbp = createFakeGbpServer()
  gbp.reviews['accounts/1/locations/1'] = [{
    name: 'accounts/1/locations/1/reviews/r-1', reviewId: 'r-1', reviewer: { displayName: 'A' }, starRating: 'FIVE',
    createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z',
  }]
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-x', role: 'owner' }] })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  for (const orgId of ['org-a', 'org-stop']) {
    await db.doc(`organizations/${orgId}/googleConnections/c-${orgId}`).set({ orgId, status: 'active', googleEmail: 'a@example.com', gbpAccounts: [], lastError: null })
    await db.doc(`oauthTokens/c-${orgId}`).set({ orgId, secret: await encryptSecret('r1') })
    await db.doc(`organizations/${orgId}/stores/st-1`).set({ orgId, name: '本店', status: 'active', connectionId: `c-${orgId}`, gbpAccountName: 'accounts/1', gbpLocationName: 'locations/1' })
  }

  const summary = await runScheduledReviewsSync(db, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(summary, { orgCount: 1, failedStoreCount: 0 })
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-1').get()).get('starRating'), 5)
  assert.equal((await db.doc('organizations/org-stop/gbpReviews/r-1').get()).exists, false)
})

test('runScheduledReviewsSync: 同期が古い組織から処理し、maxOrgs で打ち切る', async () => {
  const gbp = createFakeGbpServer()
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  await seedOrg(db, { orgId: 'org-b', members: [{ uid: 'u-owner', role: 'owner' }] })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-b', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  for (const orgId of ['org-a', 'org-b']) {
    await db.doc(`organizations/${orgId}/googleConnections/c-${orgId}`).set({ orgId, status: 'active', googleEmail: 'a@example.com', gbpAccounts: [], lastError: null })
    await db.doc(`oauthTokens/c-${orgId}`).set({ orgId, secret: await encryptSecret('r1') })
  }
  // org-b の方が前回の同期が古い
  await db.doc('organizations/org-a').update({ reviewsSyncedAt: new Date('2026-10-06T00:00:00Z') })
  await db.doc('organizations/org-b').update({ reviewsSyncedAt: new Date('2026-10-01T00:00:00Z') })

  const summary = await runScheduledReviewsSync(db, createFakeGoogle({ gbp }).deps, { maxOrgs: 1 })

  assert.equal(summary.orgCount, 1)
  const syncedB = (await db.doc('organizations/org-b').get()).get('reviewsSyncedAt').toDate()
  assert.ok(syncedB > new Date('2026-10-02T00:00:00Z'))
  assert.equal((await db.doc('organizations/org-a').get()).get('reviewsSyncedAt').toDate().toISOString(), '2026-10-06T00:00:00.000Z')
})
