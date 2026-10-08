import type { AnswerValue, Answers, Question } from './types'

// F-14 回答の CSV（モック app/utils/mock/functions/responses.ts の getResponsesCsvFunc の列の規則を移した）。
// バージョンをまたいでも列がそろうよう、全バージョンの設問を ID で集める。口コミ文面の列は出さない

export interface CsvVersion {
  version: number
  questions: Question[]
}

export interface CsvResponse {
  createdAt: Date
  surveyVersion: number
  answers: Answers
  isEligible: boolean
  redirectedAt: Date | null
}

/** Excel などで数式として解釈される先頭文字 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function escapeCsvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function formatAnswer(question: Question, answer: AnswerValue | undefined): string {
  if (answer === undefined) return ''
  if (question.type === 'single' || question.type === 'multi') {
    const ids = Array.isArray(answer) ? answer : [String(answer)]
    return ids.map(id => question.options.find(option => option.id === id)?.label ?? id).join(' / ')
  }
  return String(answer)
}

/** 回答を CSV にする。行の区切りは \n。BOM は画面側で付ける */
export function buildResponsesCsv(versions: CsvVersion[], responses: CsvResponse[]): string {
  // 古い版から順に入れ、同じ設問 ID は新しい版の設問文で上書きする（列の順は最初に出てきた順）
  const questions = new Map<string, Question>()
  for (const version of [...versions].sort((a, b) => a.version - b.version)) {
    for (const question of version.questions) questions.set(question.id, question)
  }
  const columns = [...questions.values()]
  const header = ['回答日時', 'バージョン', ...columns.map(question => question.label), '条件合致', 'Google 遷移日時']
  const rows = responses.map(response => [
    response.createdAt.toISOString(),
    String(response.surveyVersion),
    ...columns.map(question => formatAnswer(question, response.answers[question.id])),
    response.isEligible ? '○' : '',
    response.redirectedAt ? response.redirectedAt.toISOString() : '',
  ])
  return [header, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\n')
}
