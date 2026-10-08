import type { PublishPeriod, Store, Survey, SurveyContent, SurveyStatusAction } from '~/types/domain'
import { createId, createSlug } from '../random'
import type { MockDb } from '../seed'
import { MockFunctionsError, requireMember, requireOrg, requireStoreAccess } from './shared'
import { cloneData } from '../../cloneData'

// surveys/ … アンケート作成と公開管理（docs/04-features.md F-06, F-09）
// status / currentVersion / publicSurveys は Functions だけが書き換える前提。

export function createSurveyFunc(
  db: MockDb,
  uid: string,
  input: { orgId: string; storeId: string; title: string; content: SurveyContent },
): Survey {
  const org = requireOrg(db, input.orgId)
  const member = requireMember(db, input.orgId, uid)
  requireStoreAccess(member, input.storeId)
  const count = db.surveys.filter(item => item.orgId === org.id && item.status !== 'closed').length
  if (count >= org.limits.maxSurveys) {
    throw new MockFunctionsError('resource-exhausted', `アンケート数の上限（${org.limits.maxSurveys} 件）に達しています。`)
  }
  const now = new Date().toISOString()
  const survey: Survey = {
    id: createId('sv'),
    orgId: org.id,
    storeId: input.storeId,
    title: input.title.trim(),
    status: 'draft',
    publicSlug: createSlug(),
    draft: cloneData(input.content),
    currentVersion: null,
    hasUnpublishedChanges: false,
    publishPeriod: { startAt: null, endAt: null },
    createdAt: now,
    updatedAt: now,
  }
  db.surveys.push(survey)
  return survey
}

/** 公開前の検証。問題があればメッセージの一覧を返す */
export function validateSurveyForPublish(content: SurveyContent, store: Store | undefined): string[] {
  const errors: string[] = []
  if (content.questions.length === 0) errors.push('設問を 1 つ以上追加してください。')
  if (content.questions.some(question => question.label.trim() === '')) errors.push('設問文が空の設問があります。')
  if (content.questions.some(question => ['single', 'multi'].includes(question.type) && question.options.length < 2)) {
    errors.push('選択式の設問には選択肢を 2 つ以上設定してください。')
  }
  if (content.redirectRule.conditions.length === 0) errors.push('遷移条件を 1 つ以上設定してください。')
  const questionIds = new Set(content.questions.map(question => question.id))
  if (content.redirectRule.conditions.some(condition => !questionIds.has(condition.questionId))) {
    errors.push('遷移条件が削除済みの設問を参照しています。')
  }
  if (!store || store.status !== 'active') errors.push('店舗がアーカイブされているため公開できません。')
  else if (!store.reviewUrl) errors.push('店舗の口コミ URL が設定されていません。')
  return errors
}

function requireSurvey(db: MockDb, uid: string, orgId: string, surveyId: string): Survey {
  requireOrg(db, orgId)
  const member = requireMember(db, orgId, uid)
  const survey = db.surveys.find(item => item.id === surveyId && item.orgId === orgId)
  if (!survey) throw new MockFunctionsError('not-found', 'アンケートが見つかりません。')
  requireStoreAccess(member, survey.storeId)
  return survey
}

function syncPublicSnapshot(db: MockDb, survey: Survey): void {
  const version = db.surveyVersions.find(item => item.surveyId === survey.id && item.version === survey.currentVersion)
  const store = db.stores.find(item => item.id === survey.storeId)
  const index = db.publicSurveys.findIndex(item => item.surveyId === survey.id)
  if (index >= 0) db.publicSurveys.splice(index, 1)
  if (!version || !store || (survey.status !== 'published' && survey.status !== 'paused')) return
  db.publicSurveys.push({
    slug: survey.publicSlug,
    orgId: survey.orgId,
    surveyId: survey.id,
    storeId: survey.storeId,
    version: version.version,
    storeName: store.name,
    questions: cloneData(version.content.questions),
    design: cloneData(version.content.design),
    status: survey.status,
    publishPeriod: { ...survey.publishPeriod },
  })
}

/** 下書きを凍結して新しいバージョンとして公開する */
export function updateSurveyPublishFunc(db: MockDb, uid: string, orgId: string, surveyId: string): Survey {
  const survey = requireSurvey(db, uid, orgId, surveyId)
  if (survey.status === 'closed') throw new MockFunctionsError('failed-precondition', '終了したアンケートは公開できません。')
  const store = db.stores.find(item => item.id === survey.storeId)
  const errors = validateSurveyForPublish(survey.draft, store)
  if (errors.length > 0) throw new MockFunctionsError('failed-precondition', errors.join('\n'))

  const version = (survey.currentVersion ?? 0) + 1
  db.surveyVersions.push({
    orgId,
    surveyId,
    version,
    content: cloneData(survey.draft),
    publishedBy: uid,
    publishedAt: new Date().toISOString(),
  })
  survey.currentVersion = version
  survey.status = 'published'
  survey.hasUnpublishedChanges = false
  survey.updatedAt = new Date().toISOString()
  syncPublicSnapshot(db, survey)
  return survey
}

export function updateSurveyStatusFunc(db: MockDb, uid: string, orgId: string, surveyId: string, action: SurveyStatusAction): Survey {
  const survey = requireSurvey(db, uid, orgId, surveyId)
  const transitions: Record<SurveyStatusAction, { from: Survey['status'][]; to: Survey['status'] }> = {
    pause: { from: ['published'], to: 'paused' },
    resume: { from: ['paused'], to: 'published' },
    close: { from: ['published', 'paused'], to: 'closed' },
  }
  const transition = transitions[action]
  if (!transition.from.includes(survey.status)) {
    throw new MockFunctionsError('failed-precondition', 'この状態からは変更できません。')
  }
  survey.status = transition.to
  survey.updatedAt = new Date().toISOString()
  syncPublicSnapshot(db, survey)
  return survey
}

/** URL を再発行する。旧 URL（配布済み QR）は使えなくなる */
export function updateSurveySlugFunc(db: MockDb, uid: string, orgId: string, surveyId: string): string {
  const survey = requireSurvey(db, uid, orgId, surveyId)
  if (survey.status === 'closed') throw new MockFunctionsError('failed-precondition', '終了したアンケートの URL は再発行できません。')
  survey.publicSlug = createSlug()
  syncPublicSnapshot(db, survey)
  return survey.publicSlug
}

export function updateSurveyPeriodFunc(db: MockDb, uid: string, orgId: string, surveyId: string, period: PublishPeriod): void {
  const survey = requireSurvey(db, uid, orgId, surveyId)
  if (period.startAt && period.endAt && period.startAt >= period.endAt) {
    throw new MockFunctionsError('invalid-argument', '終了日時は開始日時より後にしてください。')
  }
  survey.publishPeriod = { ...period }
  syncPublicSnapshot(db, survey)
}

export function createSurveyCopyFunc(db: MockDb, uid: string, orgId: string, surveyId: string, storeId: string): Survey {
  const source = requireSurvey(db, uid, orgId, surveyId)
  return createSurveyFunc(db, uid, { orgId, storeId, title: `${source.title}（コピー）`, content: source.draft })
}
