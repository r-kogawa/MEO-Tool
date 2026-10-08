import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg, requireStoreAccess } from '../shared/members'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { SURVEY_TITLE_MAX, requireSurveyContent, validateSurveyForPublish } from './content'
import { requirePublishPeriod } from './period'
import { loadSurvey, publicSurveyRef, readPublicSource, surveysOf, versionRef, writePublicSurvey, type SurveyDoc } from './publicSurvey'
import { createSlug } from './slug'
import { nextSurveyStatus } from './status'
import type { SurveyContent, SurveyStatus, SurveyStatusAction } from './types'

// surveys/ … アンケートの作成・複製・下書き・公開管理（docs/04-features.md F-06〜F-09）。
// 権限はモックと同じ「組織のメンバー。staff は担当店舗のみ」

/** 上限の件数に数える状態（終了は数えない） */
const OPEN_STATUSES: SurveyStatus[] = ['draft', 'published', 'paused']
const STATUS_ACTIONS: readonly SurveyStatusAction[] = ['pause', 'resume', 'close']
const COPY_SUFFIX = '（コピー）'

function requireTarget(data: unknown) {
  const input = asObject(data)
  return { input, orgId: requireId(input.orgId, '組織 ID'), surveyId: requireId(input.surveyId, 'アンケート ID') }
}

function touched() {
  return { updatedAt: FieldValue.serverTimestamp() }
}

/** 店舗と件数の上限を確かめて、下書きのアンケートを作る（作成と複製で共通） */
async function createSurveyDoc(
  db: Firestore,
  caller: Caller,
  orgId: string,
  storeId: string,
  title: string,
  content: SurveyContent,
): Promise<{ id: string }> {
  const ref = surveysOf(db, orgId).doc()
  await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    const member = await requireMember(db, orgId, caller.uid, undefined, tx)
    requireStoreAccess(member, storeId)
    const store = await tx.get(db.doc(`organizations/${orgId}/stores/${storeId}`))
    if (!store.exists || store.get('status') !== 'active') fail('not-found', '店舗が見つかりません。')
    const count = (await tx.get(surveysOf(db, orgId).where('status', 'in', OPEN_STATUSES).count())).data().count
    if (count >= org.limits.maxSurveys) fail('resource-exhausted', `アンケート数の上限（${org.limits.maxSurveys} 件）に達しています。`)
    tx.create(ref, {
      orgId,
      storeId,
      title,
      status: 'draft',
      publicSlug: createSlug(),
      draft: content,
      currentVersion: null,
      hasUnpublishedChanges: false,
      publishPeriod: { startAt: null, endAt: null },
      createdAt: FieldValue.serverTimestamp(),
      ...touched(),
    })
  })
  return { id: ref.id }
}

export async function createSurveyFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  const title = requireString(input.title, 'タイトル', SURVEY_TITLE_MAX)
  const content = requireSurveyContent(input.content)
  return createSurveyDoc(db, caller, orgId, storeId, title, content)
}

/** 複製のタイトル。60 文字に収まるよう元のタイトルの末尾を切る */
function copyTitle(title: string): string {
  return `${title.slice(0, SURVEY_TITLE_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`
}

/** 元のアンケートの下書きを複製する（別の店舗も指定できる。終了したアンケートも複製できる） */
export async function createSurveyCopyFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const { input, orgId, surveyId } = requireTarget(data)
  const storeId = requireId(input.storeId, '店舗 ID')
  const { survey } = await loadSurvey(db, caller, orgId, surveyId)
  return createSurveyDoc(db, caller, orgId, storeId, copyTitle(survey.title), survey.draft)
}

/** 下書きを保存する（画面の自動保存）。形と文字数だけを検証し、中身の検証は公開時に行う */
export async function updateSurveyDraftFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const { input, orgId, surveyId } = requireTarget(data)
  const title = requireString(input.title, 'タイトル', SURVEY_TITLE_MAX)
  const draft = requireSurveyContent(input.draft)
  await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートは編集できません。')
    tx.update(ref, { title, draft, hasUnpublishedChanges: survey.currentVersion !== null, ...touched() })
  })
}

/** 下書きを新しい版として公開する。版の作成・アンケートの更新・公開データの作り直しを 1 つのトランザクションで行う */
export async function updateSurveyPublishFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ version: number }> {
  const { orgId, surveyId } = requireTarget(data)
  const version = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートは公開できません。')
    const store = await tx.get(db.doc(`organizations/${orgId}/stores/${survey.storeId}`))
    const errors = validateSurveyForPublish(
      survey.draft,
      store.exists ? { status: store.get('status'), reviewUrl: store.get('reviewUrl') ?? null } : null,
    )
    if (errors.length > 0) fail('failed-precondition', errors.join('\n'))

    const next = (survey.currentVersion ?? 0) + 1
    tx.create(versionRef(db, orgId, surveyId, next), {
      orgId,
      surveyId,
      storeId: survey.storeId,
      version: next,
      content: survey.draft,
      publishedBy: caller.uid,
      publishedAt: FieldValue.serverTimestamp(),
    })
    tx.update(ref, { status: 'published', currentVersion: next, hasUnpublishedChanges: false, ...touched() })
    const published: SurveyDoc = { ...survey, status: 'published', currentVersion: next, hasUnpublishedChanges: false }
    writePublicSurvey(tx, db, surveyId, published, survey.draft, (store.get('name') as string | undefined) ?? '')
    return next
  })
  return { version }
}

/** 一時停止・再開・終了。公開データは停止で paused、再開で published、終了で削除 */
export async function updateSurveyStatusFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ status: SurveyStatus }> {
  const { input, orgId, surveyId } = requireTarget(data)
  const action = requireOneOf(input.action, STATUS_ACTIONS, '操作')
  const status = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    const next = nextSurveyStatus(survey.status, action)
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    tx.update(ref, { status: next, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, status: next }, source.content, source.storeName)
    return next
  })
  return { status }
}

/** URL を再発行する。旧 URL（配布済みの QR）は使えなくなる */
export async function updateSurveySlugFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ slug: string }> {
  const { orgId, surveyId } = requireTarget(data)
  const slug = await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    if (survey.status === 'closed') fail('failed-precondition', '終了したアンケートの URL は再発行できません。')
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    const nextSlug = createSlug()
    tx.delete(publicSurveyRef(db, survey.publicSlug))
    tx.update(ref, { publicSlug: nextSlug, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, publicSlug: nextSlug }, source.content, source.storeName)
    return nextSlug
  })
  return { slug }
}

/** 公開期間を変える。公開データがあれば反映する */
export async function updateSurveyPeriodFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const { input, orgId, surveyId } = requireTarget(data)
  const publishPeriod = requirePublishPeriod(input.publishPeriod)
  await db.runTransaction(async (tx) => {
    const { ref, survey } = await loadSurvey(db, caller, orgId, surveyId, tx)
    const source = await readPublicSource(tx, db, orgId, surveyId, survey)
    tx.update(ref, { publishPeriod, ...touched() })
    writePublicSurvey(tx, db, surveyId, { ...survey, publishPeriod }, source.content, source.storeName)
  })
}
