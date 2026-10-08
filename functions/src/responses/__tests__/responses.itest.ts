import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { sampleContent } from '../../surveys/__tests__/sampleContent'
import { createSurveyFunc, updateSurveyPeriodFunc, updateSurveyPublishFunc, updateSurveyStatusFunc } from '../../surveys/surveys'
import { hashIp } from '../ipHash'
import { postReviewRedirectFunc, postSurveyResponseFunc, type ResponseDeps } from '../responses'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const NOW = new Date('2026-10-08T01:00:00.000Z')
const IP = '203.0.113.1'
const REVIEW_URL = 'https://search.google.com/local/writereview?placeid=p-st-1'
const CLOSED = { code: 'failed-precondition', message: '現在このアンケートは受け付けていません。' }

let slug = ''
let surveyId = ''

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }] })
  await seedStore(db, ORG, 'st-1', '渋谷店')
  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: REVIEW_URL })
  surveyId = (await createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: '来店アンケート', content: sampleContent() })).id
  await updateSurveyPublishFunc(db, OWNER, { orgId: ORG, surveyId })
  slug = (await db.doc(`organizations/${ORG}/surveys/${surveyId}`).get()).get('publicSlug')
})

function deps(now = NOW): ResponseDeps {
  return { now: () => now, ipHashSalt: () => 'test-salt' }
}

function post(submissionId: string, answers: Record<string, unknown>, options: { now?: Date; ip?: string | null } = {}) {
  return postSurveyResponseFunc(db, { slug, submissionId, answers }, { ip: options.ip === undefined ? IP : options.ip }, deps(options.now))
}

const responseCount = async () => (await db.collection(`organizations/${ORG}/responses`).get()).size
const usage = async () => (await db.doc(`organizations/${ORG}/usageMonthly/202610`).get()).get('responses')
const later = (ms: number) => new Date(NOW.getTime() + ms)

test('postSurveyResponse: 条件を満たせば口コミ URL を返し、回答と使用回数を保存する', async () => {
  const result = await post('sub-1', { 'q-overall': 5, 'q-comment': ' おいしかった ' })
  assert.deepEqual(result, { responseId: 'sub-1', isEligible: true, reviewUrl: REVIEW_URL })

  const saved = (await db.doc(`organizations/${ORG}/responses/sub-1`).get()).data()!
  assert.equal(saved.orgId, ORG)
  assert.equal(saved.surveyId, surveyId)
  assert.equal(saved.storeId, 'st-1')
  assert.equal(saved.surveyVersion, 1)
  assert.deepEqual(saved.answers, { 'q-overall': 5, 'q-comment': 'おいしかった' })
  assert.equal(saved.isEligible, true)
  assert.equal(saved.reviewDraft, null)
  assert.equal(saved.redirectedAt, null)
  assert.equal(saved.createdAt.toDate().toISOString(), NOW.toISOString())
  assert.equal(saved.ipHash, hashIp('test-salt', IP))
  assert.equal(saved.reviewUrl, undefined)
  assert.equal(await usage(), 1)

  // IP がとれない場合は unknown のハッシュ
  await post('sub-2', { 'q-overall': 3 }, { ip: null })
  assert.equal((await db.doc(`organizations/${ORG}/responses/sub-2`).get()).get('ipHash'), hashIp('test-salt', null))
  assert.equal(await usage(), 2)
})

test('postSurveyResponse: 条件を満たさなければ口コミ URL を返さない', async () => {
  assert.deepEqual(await post('sub-1', { 'q-overall': 2 }), { responseId: 'sub-1', isEligible: false, reviewUrl: null })
  assert.equal(await usage(), 1)
})

test('postSurveyResponse: 同じ submissionId の再送は 1 件のまま、保存済みの結果を返す', async () => {
  const first = await post('sub-1', { 'q-overall': 5 })
  assert.deepEqual(await post('sub-1', { 'q-overall': 1 }), first)
  assert.equal(await responseCount(), 1)
  assert.equal(await usage(), 1)
})

test('postSurveyResponse: 送信後に一時停止されても、同じ submissionId の再送は保存済みの結果を返す（Review Focus 2）', async () => {
  const first = await post('sub-1', { 'q-overall': 5 })
  await updateSurveyStatusFunc(db, OWNER, { orgId: ORG, surveyId, action: 'pause' })
  assert.deepEqual(await post('sub-1', { 'q-overall': 5 }), first)
  await assert.rejects(post('sub-2', { 'q-overall': 5 }), CLOSED)
  assert.equal(await responseCount(), 1)
})

test('postSurveyResponse: 期間外・終了後・存在しない slug は受け付けない', async () => {
  const period = (startAt: string | null, endAt: string | null) =>
    updateSurveyPeriodFunc(db, OWNER, { orgId: ORG, surveyId, publishPeriod: { startAt, endAt } })
  const outOfPeriod = { code: 'failed-precondition', message: '回答の受付期間外です。' }

  await period('2026-10-08T01:00:01.000Z', null)
  await assert.rejects(post('sub-1', { 'q-overall': 5 }), outOfPeriod)
  await period(null, '2026-10-08T00:59:59.000Z')
  await assert.rejects(post('sub-1', { 'q-overall': 5 }), outOfPeriod)
  await period('2026-10-08T01:00:00.000Z', '2026-10-08T01:00:00.001Z')
  await post('sub-1', { 'q-overall': 5 })

  await updateSurveyStatusFunc(db, OWNER, { orgId: ORG, surveyId, action: 'close' })
  await assert.rejects(post('sub-2', { 'q-overall': 5 }), CLOSED)
  await assert.rejects(postSurveyResponseFunc(db, { slug: 'nothing', submissionId: 'sub-3', answers: {} }, { ip: IP }, deps()), CLOSED)
  await assert.rejects(postSurveyResponseFunc(db, { slug, submissionId: '../x', answers: {} }, { ip: IP }, deps()), { code: 'invalid-argument' })
  assert.equal(await responseCount(), 1)
})

test('postSurveyResponse: 回答の検証に失敗したら保存せず、レート制限にも数えない', async () => {
  await assert.rejects(post('sub-1', {}), { code: 'invalid-argument', message: '「満足度」は必須です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 6 }), { message: '評価の値が不正です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 5, 'q-good': ['o-none'] }), { message: '選択肢の値が不正です。' })
  await assert.rejects(post('sub-1', { 'q-overall': 5, 'q-comment': 'あ'.repeat(501) }), { message: '自由記述は 500 文字以内で入力してください。' })
  assert.equal(await responseCount(), 0)
  assert.equal((await db.collection('rateLimits').get()).size, 0)
})

test('postSurveyResponse: 同じ接続元から 10 分に 5 件まで。6 件目は拒否、別の接続元と 10 分後は受け付ける', async () => {
  for (let index = 1; index <= 5; index++) await post(`sub-${index}`, { 'q-overall': 5 }, { now: later(index * 1000) })
  await assert.rejects(
    post('sub-6', { 'q-overall': 5 }, { now: later(6000) }),
    { code: 'resource-exhausted', message: '短時間に多くの回答が送られました。しばらくしてから再度お試しください。' },
  )
  await post('sub-7', { 'q-overall': 5 }, { now: later(6000), ip: '198.51.100.7' })
  // 1 件目（NOW + 1 秒）から 10 分と 1 ミリ秒後
  await post('sub-8', { 'q-overall': 5 }, { now: later(1000 + 10 * 60 * 1000 + 1) })

  assert.equal(await responseCount(), 7)
  const limit = await db.doc(`rateLimits/${slug}_${hashIp('test-salt', IP)}`).get()
  assert.equal((limit.get('hits') as Timestamp[]).length, 5)
  // 最後の受付（sub-8 は 1 件目の 10 分後）の 1 日後に TTL で消す
  const lastHit = later(1000 + 10 * 60 * 1000 + 1)
  assert.equal((limit.get('expireAt') as Timestamp).toMillis(), lastHit.getTime() + 24 * 60 * 60 * 1000)
})

test('postReviewRedirect: 条件を満たした回答だけ遷移日時を記録する（記録済みなら変えない）', async () => {
  await post('sub-ok', { 'q-overall': 5 })
  await post('sub-ng', { 'q-overall': 1 })

  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ok' }, deps(new Date('2026-10-08T01:05:00.000Z')))
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ok' }, deps(new Date('2026-10-08T02:00:00.000Z')))
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-ng' }, deps())
  // 対象が無くてもエラーにしない
  await postReviewRedirectFunc(db, { slug, submissionId: 'sub-none' }, deps())
  await postReviewRedirectFunc(db, { slug: 'nothing', submissionId: 'sub-ok' }, deps())

  const redirectedAt = async (id: string) => (await db.doc(`organizations/${ORG}/responses/${id}`).get()).get('redirectedAt')
  assert.equal((await redirectedAt('sub-ok')).toDate().toISOString(), '2026-10-08T01:05:00.000Z')
  assert.equal(await redirectedAt('sub-ng'), null)
  await assert.rejects(postReviewRedirectFunc(db, { slug, submissionId: '../x' }, deps()), { code: 'invalid-argument' })
})
