import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle, type FakeGbpServer } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { createGbpPostsFunc, deleteGbpPostFunc, updateGbpPostsSyncFunc } from '../posts'

const db = getTestDb()
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')
const PATH_1 = 'accounts/1/locations/1'
const STANDARD = {
  topicType: 'STANDARD',
  summary: '秋の新メニューが始まりました',
  mediaUrl: 'https://example.com/a.jpg',
  callToAction: { actionType: 'LEARN_MORE', url: 'https://example.com/menu' },
  event: null,
  offer: null,
}
let gbp: FakeGbpServer

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
})

const deps = () => createFakeGoogle({ gbp }).deps
const create = (data: object, who = OWNER) => createGbpPostsFunc(db, who, { orgId: 'org-a', ...data }, deps())
const remove = (postId: string, who = OWNER) => deleteGbpPostFunc(db, who, { orgId: 'org-a', postId }, deps())
const postDoc = (id: string) => db.doc(`organizations/org-a/gbpPosts/${id}`).get()

test('create: 選んだ店舗ごとに GBP へ投稿し、投稿名と状態を保存する', async () => {
  const result = await create({ requestId: 'req-1', storeIds: ['st-1', 'st-2'], post: STANDARD })

  assert.deepEqual(result, { succeeded: ['st-1', 'st-2'], failed: [] })
  assert.deepEqual(gbp.createdPosts.map(post => post.location).sort(), [PATH_1, 'accounts/1/locations/2'])
  assert.deepEqual(gbp.createdPosts[0]!.body, {
    languageCode: 'ja', summary: '秋の新メニューが始まりました', topicType: 'STANDARD',
    media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://example.com/a.jpg' }],
    callToAction: { actionType: 'LEARN_MORE', url: 'https://example.com/menu' },
  })
  const doc = (await postDoc('req-1_st-1')).data()!
  assert.equal(doc.storeId, 'st-1')
  assert.equal(doc.requestId, 'req-1')
  assert.match(doc.postName, /^accounts\/1\/locations\/1\/localPosts\//)
  assert.equal(doc.state, 'LIVE')
  assert.equal(doc.createdBy, 'u-owner')
  assert.equal(doc.errorMessage, null)
  assert.deepEqual(doc.callToAction, { actionType: 'LEARN_MORE', url: 'https://example.com/menu' })
})

test('create: 同じ requestId の再送では、作成済みの店舗に二重投稿しない', async () => {
  await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  const again = await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })

  assert.deepEqual(again, { succeeded: ['st-1'], failed: [] })
  assert.equal(gbp.createdPosts.length, 1)
})

test('create: 一部の店舗だけ失敗したら理由を返して FAILED を残し、再送で失敗分だけ作る', async () => {
  gbp.failingNames.push('locations/2')
  const result = await create({ requestId: 'req-1', storeIds: ['st-1', 'st-2'], post: STANDARD })

  assert.deepEqual(result.succeeded, ['st-1'])
  assert.equal(result.failed[0]!.id, 'st-2')
  assert.match(result.failed[0]!.message, /Google ビジネスプロフィールでエラー/)
  const failed = (await postDoc('req-1_st-2')).data()!
  assert.equal(failed.state, 'FAILED')
  assert.equal(failed.postName, null)
  assert.match(failed.errorMessage, /Google ビジネスプロフィールでエラー/)

  gbp.failingNames.length = 0
  const retry = await create({ requestId: 'req-1', storeIds: ['st-1', 'st-2'], post: STANDARD })

  assert.deepEqual(retry, { succeeded: ['st-1', 'st-2'], failed: [] })
  assert.equal(gbp.createdPosts.length, 2)
  assert.equal((await postDoc('req-1_st-2')).get('state'), 'LIVE')
  assert.equal((await postDoc('req-1_st-2')).get('errorMessage'), null)
})

test('create: 店舗数・内容の不正と staff の担当外は、GBP を呼ばずに全体をエラーにする', async () => {
  await assert.rejects(
    create({ requestId: 'r', storeIds: Array.from({ length: 21 }, (_, index) => `st-${index}`), post: STANDARD }),
    { code: 'invalid-argument', message: '一度に投稿できるのは 20 店舗までです。' },
  )
  await assert.rejects(create({ requestId: 'r', storeIds: [], post: STANDARD }), { code: 'invalid-argument', message: '投稿する店舗を選んでください。' })
  await assert.rejects(create({ requestId: 'r/x', storeIds: ['st-1'], post: STANDARD }), { code: 'invalid-argument' })
  await assert.rejects(create({ requestId: 'r', storeIds: ['st-1'], post: { ...STANDARD, topicType: 'EVENT' } }), { code: 'invalid-argument' })
  await assert.rejects(create({ requestId: 'r', storeIds: ['st-1', 'st-2'], post: STANDARD }, STAFF), { code: 'permission-denied' })
  assert.equal(gbp.createdPosts.length, 0)
})

test('create: staff は担当店舗に投稿できる', async () => {
  const result = await create({ requestId: 'r', storeIds: ['st-1'], post: STANDARD }, STAFF)
  assert.deepEqual(result.succeeded, ['st-1'])
  assert.equal((await postDoc('r_st-1')).get('createdBy'), 'u-staff')
})

test('delete: GBP の投稿を削除し、キャッシュも消す', async () => {
  await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  const postName = (await postDoc('req-1_st-1')).get('postName')

  await remove('req-1_st-1')

  assert.deepEqual(gbp.deletedPosts, [postName])
  assert.equal((await postDoc('req-1_st-1')).exists, false)
})

test('delete: 作成に失敗した投稿は GBP を呼ばずに消す。Google 側で既に消えていても成功にする', async () => {
  gbp.failingNames.push('locations/1')
  await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  gbp.failingNames.length = 0
  await db.doc('organizations/org-a/gbpPosts/gone_st-1').set({ orgId: 'org-a', storeId: 'st-1', postName: `${PATH_1}/localPosts/gone`, state: 'LIVE' })

  await remove('req-1_st-1')
  await remove('gone_st-1')

  assert.deepEqual(gbp.deletedPosts, [])
  assert.equal((await postDoc('req-1_st-1')).exists, false)
  assert.equal((await postDoc('gone_st-1')).exists, false)
})

test('delete: staff の担当外・利用停止中の組織・存在しない投稿は拒否する', async () => {
  await create({ requestId: 'req-1', storeIds: ['st-2'], post: STANDARD })
  await assert.rejects(remove('req-1_st-2', STAFF), { code: 'permission-denied' })
  await assert.rejects(remove('none'), { code: 'not-found', message: '投稿が見つかりません。' })
  await db.doc('organizations/org-a').update({ status: 'suspended' })
  await assert.rejects(remove('req-1_st-2'), { code: 'failed-precondition' })
  assert.deepEqual(gbp.deletedPosts, [])
})

test('sync: 状態を更新し、Google で作られた投稿を取り込み、Google で消えた投稿を消す（作成失敗分と ALERT は対象外）', async () => {
  await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  gbp.posts[PATH_1]![0]!.state = 'REJECTED'
  gbp.posts[PATH_1]!.push(
    {
      name: `${PATH_1}/localPosts/ext-1`, languageCode: 'ja', topicType: 'EVENT', summary: 'Google の画面から投稿', state: 'LIVE',
      media: [{ mediaFormat: 'PHOTO', googleUrl: 'https://lh3.example/p.jpg' }],
      event: { title: '秋祭り', schedule: { startDate: { year: 2026, month: 10, day: 10 }, startTime: { hours: 10 }, endDate: { year: 2026, month: 10, day: 12 }, endTime: { hours: 18 } } },
      createTime: '2026-10-05T00:00:00Z',
    },
    { name: `${PATH_1}/localPosts/alert-1`, languageCode: 'ja', topicType: 'ALERT', summary: 'お知らせ' },
  )
  await db.doc('organizations/org-a/gbpPosts/old_st-1').set({ orgId: 'org-a', storeId: 'st-1', postName: `${PATH_1}/localPosts/deleted`, state: 'LIVE' })
  await db.doc('organizations/org-a/gbpPosts/failed_st-1').set({ orgId: 'org-a', storeId: 'st-1', postName: null, state: 'FAILED' })

  const result = await updateGbpPostsSyncFunc(db, OWNER, { orgId: 'org-a', storeIds: ['st-1'] }, deps())

  assert.deepEqual(result, { succeeded: ['st-1'], failed: [] })
  const own = (await postDoc('req-1_st-1')).data()!
  assert.equal(own.state, 'REJECTED')
  assert.equal(own.createdBy, 'u-owner')
  assert.equal(own.requestId, 'req-1')
  const external = (await postDoc('st-1_ext-1')).data()!
  assert.equal(external.topicType, 'EVENT')
  assert.deepEqual(external.event, { title: '秋祭り', startAt: '2026-10-10T10:00', endAt: '2026-10-12T18:00' })
  assert.equal(external.mediaUrl, 'https://lh3.example/p.jpg')
  assert.equal(external.createdBy, null)
  assert.equal(external.createdAt.toDate().toISOString(), '2026-10-05T00:00:00.000Z')
  assert.equal((await postDoc('st-1_alert-1')).exists, false)
  assert.equal((await postDoc('old_st-1')).exists, false)
  assert.equal((await postDoc('failed_st-1')).exists, true)
})

test('sync: staff は担当店舗だけを同期する', async () => {
  gbp.posts['accounts/1/locations/2'] = [{ name: 'accounts/1/locations/2/localPosts/x', languageCode: 'ja', topicType: 'STANDARD', summary: 'x', state: 'LIVE' }]
  const result = await updateGbpPostsSyncFunc(db, STAFF, { orgId: 'org-a' }, deps())
  assert.deepEqual(result.succeeded, ['st-1'])
  assert.equal((await postDoc('st-2_x')).exists, false)
})

test('create: 同じ requestId の処理が並行しても、GBP には 1 回だけ投稿する', async () => {
  const results = await Promise.all([
    create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD }),
    create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD }),
  ])

  assert.equal(gbp.createdPosts.length, 1)
  // もう一方は「作成済みで成功」か「作成中で失敗（理由付き）」のどちらか
  for (const result of results) assert.equal(result.succeeded.length + result.failed.length, 1)
  assert.equal((await postDoc('req-1_st-1')).get('state'), 'LIVE')
})

test('create: 作成中の印が新しければ GBP を呼ばずに失敗、古い（関数が途中で落ちた）印なら作り直す', async () => {
  const claim = (minutesAgo: number) => db.doc('organizations/org-a/gbpPosts/req-1_st-1').set({
    orgId: 'org-a', storeId: 'st-1', postName: null, state: 'PROCESSING', claimedAt: new Date(Date.now() - minutesAgo * 60_000),
  })

  await claim(1)
  const busy = await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  assert.deepEqual(busy.succeeded, [])
  assert.equal(busy.failed[0]!.message, '同じ投稿を別の処理で作成中です。少し待ってから投稿一覧を確認してください。')
  assert.equal(gbp.createdPosts.length, 0)

  await claim(20)
  const retried = await create({ requestId: 'req-1', storeIds: ['st-1'], post: STANDARD })
  assert.deepEqual(retried.succeeded, ['st-1'])
  assert.equal(gbp.createdPosts.length, 1)
  assert.equal((await postDoc('req-1_st-1')).get('claimedAt'), null)
})
