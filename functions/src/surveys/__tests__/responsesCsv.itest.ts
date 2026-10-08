import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { commitWrites, type WriteOp } from '../../shared/firestoreWrites'
import { getResponsesCsvFunc } from '../responsesCsv'
import { createSurveyFunc, updateSurveyPublishFunc } from '../surveys'
import { sampleContent } from './sampleContent'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  for (const [storeId, name] of [['st-1', '渋谷店'], ['st-2', '新宿店']]) {
    await seedStore(db, ORG, storeId!, name!)
    await db.doc(`organizations/${ORG}/stores/${storeId}`).update({ reviewUrl: `https://search.google.com/local/writereview?placeid=p-${storeId}` })
  }
})

async function createPublished(storeId: string): Promise<string> {
  const { id } = await createSurveyFunc(db, OWNER, { orgId: ORG, storeId, title: '来店アンケート', content: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, { orgId: ORG, surveyId: id })
  return id
}

function responseData(surveyId: string, storeId: string, createdAt: string, answers: Record<string, unknown>, isEligible = false) {
  return { orgId: ORG, surveyId, storeId, surveyVersion: 1, answers, isEligible, reviewDraft: null, redirectedAt: null, createdAt: new Date(createdAt), ipHash: 'x' }
}

test('getResponsesCsv: アンケートの回答を新しい順に CSV にする。期間で絞り込める', async () => {
  const surveyId = await createPublished('st-1')
  const other = await createPublished('st-1')
  await db.doc(`organizations/${ORG}/responses/r-1`).set(responseData(surveyId, 'st-1', '2026-10-01T00:00:00.000Z', { 'q-overall': 4 }, true))
  await db.doc(`organizations/${ORG}/responses/r-2`).set(responseData(surveyId, 'st-1', '2026-10-05T00:00:00.000Z', { 'q-overall': 2, 'q-comment': 'ふつう' }))
  await db.doc(`organizations/${ORG}/responses/r-3`).set(responseData(other, 'st-1', '2026-10-06T00:00:00.000Z', { 'q-overall': 5 }))

  const { csv } = await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId })
  assert.equal(csv, [
    '回答日時,バージョン,満足度,良かった点,ご感想,条件合致,Google 遷移日時',
    '2026-10-05T00:00:00.000Z,1,2,,ふつう,,',
    '2026-10-01T00:00:00.000Z,1,4,,,○,',
  ].join('\n'))

  const recent = (await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: '2026-10-03T00:00:00.000Z' })).csv.split('\n')
  assert.equal(recent.length, 2)
  assert.match(recent[1]!, /^2026-10-05/)
  const older = (await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, to: '2026-10-03T00:00:00.000Z' })).csv.split('\n')
  assert.equal(older.length, 2)
  assert.match(older[1]!, /^2026-10-01/)
  await assert.rejects(getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: 'きのう' }), { code: 'invalid-argument' })
})

test('getResponsesCsv: staff は担当外の店舗のアンケートを出せない。storeId の指定も担当店舗だけ', async () => {
  const mine = await createPublished('st-1')
  const other = await createPublished('st-2')
  await getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: mine, storeId: 'st-1' })
  await assert.rejects(getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: other }), { code: 'permission-denied' })
  await assert.rejects(getResponsesCsvFunc(db, STAFF, { orgId: ORG, surveyId: mine, storeId: 'st-2' }), { code: 'permission-denied' })
  await assert.rejects(getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId: 'none' }), { code: 'not-found' })
})

test('getResponsesCsv: 5,000 件を超えたら resource-exhausted（期間を絞れば出せる）', async () => {
  const surveyId = await createPublished('st-1')
  const writes: WriteOp[] = Array.from({ length: 5001 }, (_, index) => (batch) => {
    const createdAt = index === 0 ? '2026-09-01T00:00:00.000Z' : '2026-10-01T00:00:00.000Z'
    batch.set(db.doc(`organizations/${ORG}/responses/r-${index}`), responseData(surveyId, 'st-1', createdAt, { 'q-overall': 5 }, true))
  })
  await commitWrites(db, writes)

  await assert.rejects(
    getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId }),
    { code: 'resource-exhausted', message: 'CSV は 5000 件までです。期間を絞ってください。' },
  )
  const { csv } = await getResponsesCsvFunc(db, OWNER, { orgId: ORG, surveyId, from: '2026-09-15T00:00:00.000Z' })
  assert.equal(csv.split('\n').length, 5001)
})
