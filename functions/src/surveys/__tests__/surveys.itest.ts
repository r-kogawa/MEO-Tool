import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import {
  createSurveyCopyFunc,
  createSurveyFunc,
  updateSurveyDraftFunc,
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
} from '../surveys'
import { sampleContent } from './sampleContent'

const db = getTestDb()
const ORG = 'org-a'
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: ORG, members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, ORG, 'st-1', '渋谷店')
  await seedStore(db, ORG, 'st-2', '新宿店')
  for (const storeId of ['st-1', 'st-2']) {
    await db.doc(`organizations/${ORG}/stores/${storeId}`).update({ reviewUrl: `https://search.google.com/local/writereview?placeid=p-${storeId}` })
  }
})

const create = (storeId = 'st-1', who = OWNER, title = '来店アンケート') =>
  createSurveyFunc(db, who, { orgId: ORG, storeId, title, content: sampleContent() })
const surveyOf = async (id: string) => (await db.doc(`organizations/${ORG}/surveys/${id}`).get()).data()!
const publicOf = (slug: string) => db.doc(`publicSurveys/${slug}`).get()
const target = (surveyId: string) => ({ orgId: ORG, surveyId })

test('createSurvey: 下書きで作成し、slug を発行する（公開データはまだ作らない）', async () => {
  const { id } = await create()
  const survey = await surveyOf(id)
  assert.equal(survey.orgId, ORG)
  assert.equal(survey.storeId, 'st-1')
  assert.equal(survey.title, '来店アンケート')
  assert.equal(survey.status, 'draft')
  assert.match(survey.publicSlug, /^[a-km-np-z2-9]{10}$/)
  assert.deepEqual(survey.draft, sampleContent())
  assert.equal(survey.currentVersion, null)
  assert.equal(survey.hasUnpublishedChanges, false)
  assert.deepEqual(survey.publishPeriod, { startAt: null, endAt: null })
  assert.ok(survey.createdAt)
  assert.equal((await publicOf(survey.publicSlug)).exists, false)
})

test('createSurvey: staff は担当店舗だけ。存在しない・アーカイブ済みの店舗、誤った入力、非メンバーは拒否', async () => {
  await create('st-1', STAFF)
  await assert.rejects(create('st-2', STAFF), { code: 'permission-denied' })
  await assert.rejects(create('st-9'), { code: 'not-found' })
  await db.doc(`organizations/${ORG}/stores/st-2`).update({ status: 'archived' })
  await assert.rejects(create('st-2'), { code: 'not-found' })
  await assert.rejects(createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: ' ', content: sampleContent() }), { code: 'invalid-argument' })
  await assert.rejects(create('st-1', OWNER, 'あ'.repeat(61)), { code: 'invalid-argument' })
  await assert.rejects(createSurveyFunc(db, OWNER, { orgId: ORG, storeId: 'st-1', title: 'x', content: { questions: 'x' } }), { code: 'invalid-argument' })
  await assert.rejects(create('st-1', caller('u-other')), { code: 'permission-denied' })
})

test('createSurvey / createSurveyCopy: 終了以外の件数で上限を判定する（終了すると作れる）', async () => {
  await db.doc(`organizations/${ORG}`).update({ 'limits.maxSurveys': 2 })
  const first = await create()
  await create()
  await assert.rejects(create(), { code: 'resource-exhausted', message: 'アンケート数の上限（2 件）に達しています。' })
  await assert.rejects(createSurveyCopyFunc(db, OWNER, { ...target(first.id), storeId: 'st-1' }), { code: 'resource-exhausted' })

  await updateSurveyPublishFunc(db, OWNER, target(first.id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(first.id), action: 'close' })
  await create()
})

test('createSurveyCopy: 下書きを別の店舗に複製する。60 文字のタイトルも 60 文字に収める', async () => {
  const { id } = await create()
  const edited = { ...sampleContent(), design: { intro: '変更後の案内', thanksMessage: 'ありがとう' } }
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: edited })

  const copied = await surveyOf((await createSurveyCopyFunc(db, OWNER, { ...target(id), storeId: 'st-2' })).id)
  const source = await surveyOf(id)
  assert.equal(copied.storeId, 'st-2')
  assert.equal(copied.title, '来店アンケート（コピー）')
  assert.equal(copied.status, 'draft')
  assert.equal(copied.currentVersion, null)
  assert.deepEqual(copied.draft, edited)
  assert.notEqual(copied.publicSlug, source.publicSlug)

  const long = await create('st-1', OWNER, 'あ'.repeat(60))
  const longCopy = await surveyOf((await createSurveyCopyFunc(db, OWNER, { ...target(long.id), storeId: 'st-1' })).id)
  assert.equal(longCopy.title, `${'あ'.repeat(55)}（コピー）`)
  assert.equal(longCopy.title.length, 60)
})

test('createSurveyCopy: staff は担当外の店舗へも、担当外の店舗からも複製できない', async () => {
  const mine = await create('st-1', STAFF)
  await assert.rejects(createSurveyCopyFunc(db, STAFF, { ...target(mine.id), storeId: 'st-2' }), { code: 'permission-denied' })
  const other = await create('st-2')
  await assert.rejects(createSurveyCopyFunc(db, STAFF, { ...target(other.id), storeId: 'st-1' }), { code: 'permission-denied' })
  await assert.rejects(createSurveyCopyFunc(db, OWNER, { ...target('none'), storeId: 'st-1' }), { code: 'not-found' })
})

test('updateSurveyDraft: 下書きを保存する。公開版があれば未公開の変更ありにする。終了後は不可', async () => {
  const { id } = await create()
  const editing = sampleContent()
  editing.questions[0]!.label = ''
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: ' 新しいタイトル ', draft: editing })
  const saved = await surveyOf(id)
  assert.equal(saved.title, '新しいタイトル')
  assert.deepEqual(saved.draft, editing)
  assert.equal(saved.hasUnpublishedChanges, false)

  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '新しいタイトル', draft: sampleContent() })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  assert.equal((await surveyOf(id)).hasUnpublishedChanges, false)
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '新しいタイトル', draft: editing })
  assert.equal((await surveyOf(id)).hasUnpublishedChanges, true)

  const tooLong = { ...sampleContent(), questions: [{ ...sampleContent().questions[0]!, label: 'あ'.repeat(101) }] }
  await assert.rejects(updateSurveyDraftFunc(db, OWNER, { ...target(id), title: 'x', draft: tooLong }), { code: 'invalid-argument' })
  await assert.rejects(updateSurveyDraftFunc(db, OWNER, { ...target('none'), title: 'x', draft: sampleContent() }), { code: 'not-found' })

  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(
    updateSurveyDraftFunc(db, OWNER, { ...target(id), title: 'x', draft: sampleContent() }),
    { code: 'failed-precondition', message: '終了したアンケートは編集できません。' },
  )
})

test('updateSurveyPublish: 版を作り、公開データを作り直す（遷移ルール・生成設定・口コミ URL は含めない）', async () => {
  const { id } = await create()
  assert.deepEqual(await updateSurveyPublishFunc(db, OWNER, target(id)), { version: 1 })

  const survey = await surveyOf(id)
  assert.equal(survey.status, 'published')
  assert.equal(survey.currentVersion, 1)
  assert.equal(survey.hasUnpublishedChanges, false)
  const version = (await db.doc(`organizations/${ORG}/surveyVersions/${id}_1`).get()).data()!
  assert.equal(version.orgId, ORG)
  assert.equal(version.surveyId, id)
  assert.equal(version.storeId, 'st-1')
  assert.equal(version.version, 1)
  assert.deepEqual(version.content, sampleContent())
  assert.equal(version.publishedBy, 'u-owner')
  const published = (await publicOf(survey.publicSlug)).data()!
  assert.deepEqual(Object.keys(published).sort(), ['design', 'orgId', 'publishPeriod', 'questions', 'slug', 'status', 'storeId', 'storeName', 'surveyId', 'version'])
  assert.equal(published.slug, survey.publicSlug)
  assert.equal(published.storeName, '渋谷店')
  assert.equal(published.status, 'published')
  assert.equal(published.version, 1)
  assert.deepEqual(published.questions, sampleContent().questions)
  assert.deepEqual(published.design, sampleContent().design)

  // 変更を公開すると版が増え、前の版は変わらない
  const next = sampleContent()
  next.questions.push({ id: 'q-new', type: 'text', label: '追加の設問', isRequired: false, options: [], useForReviewDraft: false })
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: next })
  assert.deepEqual(await updateSurveyPublishFunc(db, OWNER, target(id)), { version: 2 })
  assert.equal((await db.doc(`organizations/${ORG}/surveyVersions/${id}_1`).get()).get('content.questions').length, 3)
  const republished = await publicOf(survey.publicSlug)
  assert.equal(republished.get('version'), 2)
  assert.equal(republished.get('questions').length, 4)
})

test('updateSurveyPublish: 停止中に変更を公開すると公開中に戻る（モックと同じ）', async () => {
  const { id } = await create()
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const survey = await surveyOf(id)
  assert.equal(survey.status, 'published')
  assert.equal((await publicOf(survey.publicSlug)).get('status'), 'published')
})

test('updateSurveyPublish: 公開前の検証に失敗したら公開しない。終了後は不可', async () => {
  const { id } = await create()
  const noRule = { ...sampleContent(), redirectRule: { operator: 'and', conditions: [] } }
  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: noRule })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '遷移条件を 1 つ以上設定してください。' })
  assert.equal((await surveyOf(id)).status, 'draft')
  assert.equal((await db.collection(`organizations/${ORG}/surveyVersions`).get()).size, 0)

  await updateSurveyDraftFunc(db, OWNER, { ...target(id), title: '来店アンケート', draft: sampleContent() })
  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: '' })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '店舗の口コミ URL が設定されていません。' })

  await db.doc(`organizations/${ORG}/stores/st-1`).update({ reviewUrl: 'https://search.google.com/local/writereview?placeid=p-st-1' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(updateSurveyPublishFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '終了したアンケートは公開できません。' })
})

test('updateSurveyStatus: 停止で paused、再開で published、終了で公開データを削除する', async () => {
  const { id } = await create()
  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' }), { code: 'failed-precondition', message: 'この状態からは変更できません。' })
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const { publicSlug } = await surveyOf(id)

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' }), { status: 'paused' })
  assert.equal((await surveyOf(id)).status, 'paused')
  assert.equal((await publicOf(publicSlug)).get('status'), 'paused')

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'resume' }), { status: 'published' })
  assert.equal((await publicOf(publicSlug)).get('status'), 'published')

  assert.deepEqual(await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' }), { status: 'closed' })
  assert.equal((await surveyOf(id)).status, 'closed')
  assert.equal((await publicOf(publicSlug)).exists, false)

  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'resume' }), { code: 'failed-precondition' })
  await assert.rejects(updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'stop' }), { code: 'invalid-argument' })
})

test('updateSurveySlug: 古い公開データを消し、公開中・停止中なら新しい slug で作り直す。終了後は不可', async () => {
  const { id } = await create()
  const first = (await surveyOf(id)).publicSlug
  const { slug: second } = await updateSurveySlugFunc(db, OWNER, target(id))
  assert.notEqual(second, first)
  assert.equal((await surveyOf(id)).publicSlug, second)
  assert.equal((await publicOf(second)).exists, false)

  await updateSurveyPublishFunc(db, OWNER, target(id))
  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'pause' })
  const { slug: third } = await updateSurveySlugFunc(db, OWNER, target(id))
  assert.equal((await publicOf(second)).exists, false)
  const reissued = await publicOf(third)
  assert.equal(reissued.get('slug'), third)
  assert.equal(reissued.get('status'), 'paused')

  await updateSurveyStatusFunc(db, OWNER, { ...target(id), action: 'close' })
  await assert.rejects(updateSurveySlugFunc(db, OWNER, target(id)), { code: 'failed-precondition', message: '終了したアンケートの URL は再発行できません。' })
})

test('updateSurveyPeriod: 期間を保存し、公開データにも反映する。終了は開始より後', async () => {
  const { id } = await create()
  await updateSurveyPublishFunc(db, OWNER, target(id))
  const period = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-31T15:00:00.000Z' }
  await updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: period })

  const survey = await surveyOf(id)
  assert.equal(survey.publishPeriod.startAt.toDate().toISOString(), period.startAt)
  assert.equal(survey.publishPeriod.endAt.toDate().toISOString(), period.endAt)
  assert.equal((await publicOf(survey.publicSlug)).get('publishPeriod.endAt').toDate().toISOString(), period.endAt)

  await updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: { startAt: null, endAt: null } })
  assert.equal((await publicOf(survey.publicSlug)).get('publishPeriod.startAt'), null)

  await assert.rejects(
    updateSurveyPeriodFunc(db, OWNER, { ...target(id), publishPeriod: { startAt: period.endAt, endAt: period.startAt } }),
    { code: 'invalid-argument', message: '終了日時は開始日時より後にしてください。' },
  )
})

test('担当外の店舗のアンケートは、staff は保存・公開・状態・slug・期間を操作できない', async () => {
  const { id } = await create('st-2')
  const denied = { code: 'permission-denied' }
  await assert.rejects(updateSurveyDraftFunc(db, STAFF, { ...target(id), title: 'x', draft: sampleContent() }), denied)
  await assert.rejects(updateSurveyPublishFunc(db, STAFF, target(id)), denied)
  await updateSurveyPublishFunc(db, OWNER, target(id))
  await assert.rejects(updateSurveyStatusFunc(db, STAFF, { ...target(id), action: 'pause' }), denied)
  await assert.rejects(updateSurveySlugFunc(db, STAFF, target(id)), denied)
  await assert.rejects(updateSurveyPeriodFunc(db, STAFF, { ...target(id), publishPeriod: { startAt: null, endAt: null } }), denied)
  await assert.rejects(updateSurveyPublishFunc(db, caller('u-other'), target(id)), denied)
})
