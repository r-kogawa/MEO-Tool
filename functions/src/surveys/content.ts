import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type {
  Comparator,
  Question,
  QuestionOption,
  QuestionType,
  RedirectCondition,
  ReviewDraftSettings,
  SurveyContent,
  SurveyDesign,
} from './types'

// アンケートの中身の検証。
// 下書きの保存では形と文字数だけを見て（編集途中の空の設問文は許す）、公開時に validateSurveyForPublish で中身を確かめる。
// 上限は編集画面の入力欄（maxlength・QUESTION_LIMIT など）と合わせる

export const SURVEY_TITLE_MAX = 60
export const QUESTION_LIMIT = 20
export const OPTION_LIMIT = 10
export const CONDITION_LIMIT = 20
const QUESTION_LABEL_MAX = 100
const OPTION_LABEL_MAX = 40
const DESIGN_TEXT_MAX = 200
const HIGHLIGHT_LIMIT = 5
const HIGHLIGHT_MAX = 30
const NG_WORD_LIMIT = 50
const NG_WORD_MAX = 20
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const QUESTION_TYPES: readonly QuestionType[] = ['rating', 'nps', 'single', 'multi', 'text']
const COMPARATORS: readonly Comparator[] = ['eq', 'neq', 'gte', 'lte', 'includes', 'notIncludes', 'notEmpty']
const SHAPE_ERROR = 'アンケートの内容の形式が正しくありません。'

function invalid(message = SHAPE_ERROR): never {
  return fail('invalid-argument', message)
}

/** 設問・選択肢・条件の ID */
function itemId(value: unknown): string {
  if (typeof value !== 'string' || !ITEM_ID_PATTERN.test(value)) invalid()
  return value
}

/** 空文字を許す文字列。上限を超えたら message で拒否する */
function text(value: unknown, max: number, message: string): string {
  if (typeof value !== 'string') invalid()
  if (value.length > max) invalid(message)
  return value
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid()
  return value
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid()
  return value as T
}

function list(value: unknown, maxItems: number, message: string): unknown[] {
  if (!Array.isArray(value)) invalid()
  if (value.length > maxItems) invalid(message)
  return value
}

function textList(value: unknown, maxItems: number, maxLength: number, label: string): string[] {
  return list(value, maxItems, `${label}は ${maxItems} 件までです。`)
    .map(item => text(item, maxLength, `${label}は 1 件 ${maxLength} 文字以内にしてください。`))
}

function readOption(value: unknown): QuestionOption {
  const input = asObject(value)
  return { id: itemId(input.id), label: text(input.label, OPTION_LABEL_MAX, `選択肢は ${OPTION_LABEL_MAX} 文字以内にしてください。`) }
}

function readQuestion(value: unknown): Question {
  const input = asObject(value)
  return {
    id: itemId(input.id),
    type: oneOf(input.type, QUESTION_TYPES),
    label: text(input.label, QUESTION_LABEL_MAX, `設問文は ${QUESTION_LABEL_MAX} 文字以内にしてください。`),
    isRequired: flag(input.isRequired),
    options: list(input.options, OPTION_LIMIT, `選択肢は ${OPTION_LIMIT} 個までです。`).map(readOption),
    useForReviewDraft: flag(input.useForReviewDraft),
  }
}

function readCondition(value: unknown): RedirectCondition {
  const input = asObject(value)
  const expected = input.value
  if (expected !== null && typeof expected !== 'number' && typeof expected !== 'string') invalid()
  return {
    id: itemId(input.id),
    questionId: itemId(input.questionId),
    comparator: oneOf(input.comparator, COMPARATORS),
    value: expected as number | string | null,
  }
}

function readSettings(value: unknown): ReviewDraftSettings {
  const input = asObject(value)
  return {
    isEnabled: flag(input.isEnabled),
    tone: oneOf(input.tone, ['casual', 'polite'] as const),
    length: oneOf(input.length, ['short', 'medium'] as const),
    storeHighlights: textList(input.storeHighlights, HIGHLIGHT_LIMIT, HIGHLIGHT_MAX, '店舗の特徴'),
    ngWords: textList(input.ngWords, NG_WORD_LIMIT, NG_WORD_MAX, 'NG ワード'),
  }
}

function readDesign(value: unknown): SurveyDesign {
  const input = asObject(value)
  const message = `案内文は ${DESIGN_TEXT_MAX} 文字以内にしてください。`
  return { intro: text(input.intro, DESIGN_TEXT_MAX, message), thanksMessage: text(input.thanksMessage, DESIGN_TEXT_MAX, message) }
}

/** 下書きの形と文字数を検証し、既知の項目だけを持つ値を返す */
export function requireSurveyContent(value: unknown): SurveyContent {
  const input = asObject(value)
  const questions = list(input.questions, QUESTION_LIMIT, `設問は ${QUESTION_LIMIT} 問までです。`).map(readQuestion)
  if (new Set(questions.map(question => question.id)).size !== questions.length) invalid()
  const rule = asObject(input.redirectRule)
  return {
    questions,
    redirectRule: {
      operator: oneOf(rule.operator, ['and', 'or'] as const),
      conditions: list(rule.conditions, CONDITION_LIMIT, `遷移条件は ${CONDITION_LIMIT} 件までです。`).map(readCondition),
    },
    reviewDraftSettings: readSettings(input.reviewDraftSettings),
    design: readDesign(input.design),
  }
}

export interface PublishStore {
  status: string
  reviewUrl: string | null
}

/** 公開前の検証（モック app/utils/mock/functions/surveys.ts の validateSurveyForPublish と同じ規則）。問題が無ければ空配列 */
export function validateSurveyForPublish(content: SurveyContent, store: PublishStore | null): string[] {
  const errors: string[] = []
  if (content.questions.length === 0) errors.push('設問を 1 つ以上追加してください。')
  if (content.questions.some(question => question.label.trim() === '')) errors.push('設問文が空の設問があります。')
  if (content.questions.some(question => (question.type === 'single' || question.type === 'multi') && question.options.length < 2)) {
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
