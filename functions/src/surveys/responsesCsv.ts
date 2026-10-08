import type { DocumentData, Firestore, Query, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireStoreAccess } from '../shared/members'
import { asObject, requireId } from '../shared/validation'
import { buildResponsesCsv, type CsvResponse, type CsvVersion } from './csv'
import { parseOptionalDate } from './period'
import { loadSurvey } from './publicSurvey'

// F-14 回答の CSV。画面の購読（直近 90 日・2,000 件）とは別に、サーバー側で回答を検索し直す

export const CSV_LIMIT = 5000

function toCsvResponse(data: DocumentData): CsvResponse {
  return {
    createdAt: (data.createdAt as Timestamp).toDate(),
    surveyVersion: data.surveyVersion,
    answers: data.answers ?? {},
    isEligible: data.isEligible === true,
    redirectedAt: data.redirectedAt ? (data.redirectedAt as Timestamp).toDate() : null,
  }
}

export async function getResponsesCsvFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ csv: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const surveyId = requireId(input.surveyId, 'アンケート ID')
  const storeId = input.storeId == null ? null : requireId(input.storeId, '店舗 ID')
  const from = parseOptionalDate(input.from, '期間')
  const to = parseOptionalDate(input.to, '期間')
  const { member } = await loadSurvey(db, caller, orgId, surveyId)
  if (storeId) requireStoreAccess(member, storeId)

  // インデックス: responses (surveyId, createdAt DESC) / (surveyId, storeId, createdAt DESC)
  let responses: Query = db.collection(`organizations/${orgId}/responses`).where('surveyId', '==', surveyId)
  if (storeId) responses = responses.where('storeId', '==', storeId)
  if (from) responses = responses.where('createdAt', '>=', from)
  if (to) responses = responses.where('createdAt', '<=', to)
  const [found, versions] = await Promise.all([
    responses.orderBy('createdAt', 'desc').limit(CSV_LIMIT + 1).get(),
    db.collection(`organizations/${orgId}/surveyVersions`).where('surveyId', '==', surveyId).get(),
  ])
  if (found.size > CSV_LIMIT) fail('resource-exhausted', `CSV は ${CSV_LIMIT} 件までです。期間を絞ってください。`)

  const csvVersions: CsvVersion[] = versions.docs.map(doc => ({ version: doc.get('version'), questions: doc.get('content.questions') ?? [] }))
  return { csv: buildResponsesCsv(csvVersions, found.docs.map(doc => toCsvResponse(doc.data()))) }
}
