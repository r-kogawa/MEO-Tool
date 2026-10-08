import type { Answers, Question, SurveyResponse } from '~/types/domain'
import { evaluateRedirectRule } from '../../evaluateRedirectRule'
import type { MockDb } from '../seed'
import { MockFunctionsError, currentUsage, requireMember } from './shared'
import { cloneData } from '../../cloneData'

// responses/ … 回答受付・条件判定・口コミ下書き生成・遷移ログ（docs/04-features.md F-10〜F-13）

const MAX_TEXT_LENGTH = 500

function validateAnswers(questions: Question[], answers: Answers): void {
  for (const question of questions) {
    const answer = answers[question.id]
    const isEmpty = answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)
    if (question.isRequired && isEmpty) throw new MockFunctionsError('invalid-argument', `「${question.label}」は必須です。`)
    if (isEmpty) continue
    if (question.type === 'rating' && (typeof answer !== 'number' || answer < 1 || answer > 5)) {
      throw new MockFunctionsError('invalid-argument', '評価の値が不正です。')
    }
    if (question.type === 'nps' && (typeof answer !== 'number' || answer < 0 || answer > 10)) {
      throw new MockFunctionsError('invalid-argument', '評価の値が不正です。')
    }
    if (question.type === 'single' || question.type === 'multi') {
      const ids = Array.isArray(answer) ? answer : [answer]
      if (!ids.every(id => question.options.some(option => option.id === id))) {
        throw new MockFunctionsError('invalid-argument', '選択肢の値が不正です。')
      }
    }
    if (question.type === 'text' && (typeof answer !== 'string' || answer.length > MAX_TEXT_LENGTH)) {
      throw new MockFunctionsError('invalid-argument', `自由記述は ${MAX_TEXT_LENGTH} 文字以内で入力してください。`)
    }
  }
}

export function isWithinPeriod(period: { startAt: string | null; endAt: string | null }, now = new Date()): boolean {
  if (period.startAt && Date.parse(period.startAt) > now.getTime()) return false
  if (period.endAt && Date.parse(period.endAt) < now.getTime()) return false
  return true
}

interface PostSurveyResponseInput {
  slug: string
  /** クライアント生成の ID。再送信しても 1 件になる */
  submissionId: string
  answers: Answers
}

export function postSurveyResponseFunc(db: MockDb, input: PostSurveyResponseInput): { responseId: string; isEligible: boolean } {
  const existing = db.responses.find(item => item.id === input.submissionId)
  if (existing) return { responseId: existing.id, isEligible: existing.isEligible }

  const snapshot = db.publicSurveys.find(item => item.slug === input.slug)
  if (!snapshot || snapshot.status !== 'published') throw new MockFunctionsError('failed-precondition', '現在このアンケートは受け付けていません。')
  if (!isWithinPeriod(snapshot.publishPeriod)) throw new MockFunctionsError('failed-precondition', '回答の受付期間外です。')

  // 回答画面に渡していない遷移条件は、公開版（versions）から読む
  const version = db.surveyVersions.find(item => item.surveyId === snapshot.surveyId && item.version === snapshot.version)
  if (!version) throw new MockFunctionsError('not-found', 'アンケートが見つかりません。')
  validateAnswers(version.content.questions, input.answers)

  const response: SurveyResponse = {
    id: input.submissionId,
    orgId: snapshot.orgId,
    surveyId: snapshot.surveyId,
    storeId: snapshot.storeId,
    surveyVersion: version.version,
    answers: cloneData(input.answers),
    isEligible: evaluateRedirectRule(version.content.redirectRule, input.answers),
    reviewDraft: null,
    redirectedAt: null,
    createdAt: new Date().toISOString(),
  }
  db.responses.push(response)
  currentUsage(db, response.orgId).responses++
  return { responseId: response.id, isEligible: response.isEligible }
}

/** 「Google で投稿」押下の記録。実際に投稿されたかは検知できない */
export function postReviewRedirectFunc(db: MockDb, responseId: string): void {
  const response = db.responses.find(item => item.id === responseId)
  if (!response || !response.isEligible) return
  response.redirectedAt ??= new Date().toISOString()
}

const CSV_LIMIT = 5000

/** Excel などで数式として解釈される先頭文字（functions/src/surveys/csv.ts の escapeCsvCell と同じ規則） */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

function escapeCsv(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function getResponsesCsvFunc(db: MockDb, uid: string, orgId: string, surveyId: string, responses: SurveyResponse[]): string {
  requireMember(db, orgId, uid)
  const survey = db.surveys.find(item => item.id === surveyId && item.orgId === orgId)
  if (!survey) throw new MockFunctionsError('not-found', 'アンケートが見つかりません。')
  if (responses.length > CSV_LIMIT) throw new MockFunctionsError('resource-exhausted', `CSV は ${CSV_LIMIT} 件までです。期間を絞ってください。`)

  // バージョンをまたいでも列がそろうよう、全バージョンの設問を ID で集める
  const questions = new Map<string, Question>()
  for (const version of db.surveyVersions.filter(item => item.surveyId === surveyId)) {
    for (const question of version.content.questions) questions.set(question.id, question)
  }
  const header = ['回答日時', 'バージョン', ...[...questions.values()].map(question => question.label), '条件合致', 'Google 遷移日時']
  const rows = responses.map((response) => {
    const answers = [...questions.values()].map((question) => {
      const answer = response.answers[question.id]
      if (answer === undefined) return ''
      const ids = Array.isArray(answer) ? answer : [answer]
      if (question.type === 'single' || question.type === 'multi') {
        return ids.map(id => question.options.find(option => option.id === id)?.label ?? id).join(' / ')
      }
      return String(answer)
    })
    return [response.createdAt, String(response.surveyVersion), ...answers, response.isEligible ? '○' : '', response.redirectedAt ?? '']
  })
  return [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n')
}
