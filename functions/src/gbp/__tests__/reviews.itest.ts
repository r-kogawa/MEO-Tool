import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle, type FakeGbpServer } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import type { GbpReview } from '../../shared/gbp'
import { encryptSecret } from '../../shared/secrets'
import { deleteGbpReviewReplyFunc, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from '../reviews'

const db = getTestDb()
const OWNER = caller('u-owner')
const PATH_1 = 'accounts/1/locations/1'
const PATH_2 = 'accounts/1/locations/2'
let gbp: FakeGbpServer

function review(path: string, id: string, overrides: Partial<GbpReview> = {}): GbpReview {
  return {
    name: `${path}/reviews/${id}`,
    reviewId: id,
    reviewer: { displayName: `投稿者 ${id}` },
    starRating: 'FOUR',
    comment: `本文 ${id}`,
    createTime: '2026-10-01T03:00:00Z',
    updateTime: '2026-10-01T03:00:00Z',
    ...overrides,
  }
}

beforeEach(async () => {
  await clearFirestore()
  gbp = createFakeGbpServer()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ orgId: 'org-a', status: 'active', googleEmail: 'a@example.com', gbpAccounts: [], lastError: null })
  await db.doc('oauthTokens/c-1').set({ orgId: 'org-a', secret: await encryptSecret('r1') })
  for (const [id, location] of [['st-1', '1'], ['st-2', '2']]) {
    await db.doc(`organizations/org-a/stores/${id}`).set({ orgId: 'org-a', name: `店舗 ${id}`, status: 'active', connectionId: 'c-1', gbpAccountName: 'accounts/1', gbpLocationName: `locations/${location}` })
  }
  gbp.reviews[PATH_1] = [
    review(PATH_1, 'r-a', { reviewReply: { comment: 'ありがとうございます', updateTime: '2026-10-02T00:00:00Z' } }),
    review(PATH_1, 'r-b', { comment: undefined, starRating: 'FIVE', reviewer: { isAnonymous: true } }),
  ]
  gbp.reviews[PATH_2] = [review(PATH_2, 'r-c')]
})

const sync = (who = OWNER, data: object = { orgId: 'org-a' }) => updateGbpReviewsSyncFunc(db, who, data, createFakeGoogle({ gbp }).deps)
const reviewDoc = async (id: string) => (await db.doc(`organizations/org-a/gbpReviews/${id}`).get()).data()!

test('reviewsSync: 全店舗の口コミを保存する（返信・評価のみ・匿名）', async () => {
  const result = await sync()

  assert.deepEqual(result, { succeeded: ['st-1', 'st-2'], failed: [] })
  const replied = await reviewDoc('r-a')
  assert.equal(replied.storeId, 'st-1')
  assert.equal(replied.reviewName, `${PATH_1}/reviews/r-a`)
  assert.equal(replied.starRating, 4)
  assert.equal(replied.hasReply, true)
  assert.equal(replied.reply.comment, 'ありがとうございます')
  assert.equal(replied.reviewCreatedAt.toDate().toISOString(), '2026-10-01T03:00:00.000Z')
  const anonymous = await reviewDoc('r-b')
  assert.equal(anonymous.comment, null)
  assert.equal(anonymous.reviewerName, '匿名')
  assert.equal(anonymous.isAnonymous, true)
  assert.equal(anonymous.starRating, 5)
  assert.equal(anonymous.hasReply, false)
  assert.equal(anonymous.reply, null)
})

test('reviewsSync: staff は担当店舗の口コミだけを同期する', async () => {
  const result = await sync(caller('u-staff'))
  assert.deepEqual(result.succeeded, ['st-1'])
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-c').get()).exists, false)
})

test('reply: 個別・一括とも同じ関数で返信し、キャッシュを更新する', async () => {
  await sync()

  const result = await updateGbpReviewReplyFunc(db, OWNER, {
    orgId: 'org-a',
    items: [{ reviewId: 'r-b', comment: 'ご来店ありがとうございました' }, { reviewId: 'r-c', comment: 'またお待ちしております' }],
  }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result, { succeeded: ['r-b', 'r-c'], failed: [] })
  // 並列で送るため順序は問わない
  assert.deepEqual([...gbp.replies].sort((a, b) => a.name.localeCompare(b.name)), [
    { name: `${PATH_1}/reviews/r-b`, comment: 'ご来店ありがとうございました' },
    { name: `${PATH_2}/reviews/r-c`, comment: 'またお待ちしております' },
  ])
  const updated = await reviewDoc('r-b')
  assert.equal(updated.hasReply, true)
  assert.equal(updated.reply.comment, 'ご来店ありがとうございました')
})

test('reply: 一部だけ GBP が拒否しても他は返信し、失敗分を理由付きで返す', async () => {
  await sync()
  gbp.failingNames.push('reviews/r-b')

  const result = await updateGbpReviewReplyFunc(db, OWNER, {
    orgId: 'org-a',
    items: [{ reviewId: 'r-b', comment: 'a' }, { reviewId: 'r-c', comment: 'b' }],
  }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result.succeeded, ['r-c'])
  assert.equal(result.failed[0]!.id, 'r-b')
  assert.match(result.failed[0]!.message, /Google ビジネスプロフィールでエラー/)
  assert.equal((await reviewDoc('r-b')).hasReply, false)
})

test('reply: 4096 バイトを超える返信・空の返信・51 件以上は GBP を呼ばずに invalid-argument', async () => {
  await sync()
  const fake = createFakeGoogle({ gbp })
  // 日本語 1 文字は 3 バイト。1366 文字 = 4098 バイト
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: 'あ'.repeat(1366) }] }, fake.deps),
    { code: 'invalid-argument', message: '返信は 4096 バイト以内にしてください（日本語は約 1,300 文字）。' },
  )
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: '  ' }] }, fake.deps),
    { code: 'invalid-argument' },
  )
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: Array.from({ length: 51 }, () => ({ reviewId: 'r-b', comment: 'a' })) }, fake.deps),
    { code: 'invalid-argument', message: '一度に返信できるのは 50 件までです。' },
  )
  await updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: 'あ'.repeat(1365) }] }, fake.deps)
  assert.equal(gbp.replies.length, 1)
})

test('reply: staff の担当外が 1 件でも混ざれば全体を拒否し、GBP を呼ばない', async () => {
  await sync()
  await assert.rejects(
    updateGbpReviewReplyFunc(db, caller('u-staff'), {
      orgId: 'org-a',
      items: [{ reviewId: 'r-b', comment: 'a' }, { reviewId: 'r-c', comment: 'b' }],
    }, createFakeGoogle({ gbp }).deps),
    { code: 'permission-denied' },
  )
  assert.equal(gbp.replies.length, 0)
})

test('reply: 同期していない口コミは not-found', async () => {
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-x', comment: 'a' }] }, createFakeGoogle({ gbp }).deps),
    { code: 'not-found', message: '口コミが見つかりません。同期してからやり直してください。' },
  )
})

test('deleteReply: GBP の返信を削除し、キャッシュを未返信に戻す', async () => {
  await sync()
  await deleteGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', reviewId: 'r-a' }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(gbp.deletedReplies, [`${PATH_1}/reviews/r-a`])
  const updated = await reviewDoc('r-a')
  assert.equal(updated.hasReply, false)
  assert.equal(updated.reply, null)
})

test('reviewsSync: 同期より新しいキャッシュの返信は上書きしない', async () => {
  await sync()
  // 同期中にスタッフが返信した状況: キャッシュの返信は API の値より新しい
  await db.doc('organizations/org-a/gbpReviews/r-b').update({ reply: { comment: '直前の返信', updatedAt: new Date('2026-10-08T00:00:00Z') }, hasReply: true })

  await sync()

  const doc = await reviewDoc('r-b')
  assert.equal(doc.hasReply, true)
  assert.equal(doc.reply.comment, '直前の返信')
})

test('reviewsSync: Google 側で消えた口コミはキャッシュから削除する（他店舗は残す）', async () => {
  await sync()
  gbp.reviews[PATH_1] = [gbp.reviews[PATH_1]![0]!]

  await sync()

  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-a').get()).exists, true)
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-b').get()).exists, false)
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-c').get()).exists, true)
})

test('reviewsSync: 変化のない口コミは書き直さない（syncedAt が変わらない）', async () => {
  await sync()
  const before = (await reviewDoc('r-c')).syncedAt.toMillis()
  await new Promise(resolve => setTimeout(resolve, 20))

  await sync()

  assert.equal((await reviewDoc('r-c')).syncedAt.toMillis(), before)
})

test('reply: 長い reviewId（200 文字）の口コミにも返信できる', async () => {
  const longId = 'A'.repeat(200)
  gbp.reviews[PATH_2] = [review(PATH_2, longId)]
  await sync()

  const result = await updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: longId, comment: 'ありがとう' }] }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result.succeeded, [longId])
})

test('deleteReply: 利用停止中の組織は failed-precondition で、GBP を呼ばない', async () => {
  await sync()
  await db.doc('organizations/org-a').update({ status: 'suspended' })

  await assert.rejects(
    deleteGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', reviewId: 'r-a' }, createFakeGoogle({ gbp }).deps),
    { code: 'failed-precondition' },
  )
  assert.deepEqual(gbp.deletedReplies, [])
})
