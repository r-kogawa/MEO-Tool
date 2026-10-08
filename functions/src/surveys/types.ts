// アンケート（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 1 章）の型。
// app/types/domain.ts の同名の型と同じ形。日時は Date（Firestore では Timestamp）で持つ

export type SurveyStatus = 'draft' | 'published' | 'paused' | 'closed'
export type SurveyStatusAction = 'pause' | 'resume' | 'close'

export type QuestionType = 'rating' | 'nps' | 'single' | 'multi' | 'text'

export interface QuestionOption {
  id: string
  label: string
}

export interface Question {
  id: string
  type: QuestionType
  label: string
  isRequired: boolean
  options: QuestionOption[]
  useForReviewDraft: boolean
}

export type Comparator = 'eq' | 'neq' | 'gte' | 'lte' | 'includes' | 'notIncludes' | 'notEmpty'

export interface RedirectCondition {
  id: string
  questionId: string
  comparator: Comparator
  value: number | string | null
}

export interface RedirectRule {
  operator: 'and' | 'or'
  conditions: RedirectCondition[]
}

/** 口コミ文面の生成設定。今回は生成を作らないが、値は保存時にそのまま残す */
export interface ReviewDraftSettings {
  isEnabled: boolean
  tone: 'casual' | 'polite'
  length: 'short' | 'medium'
  storeHighlights: string[]
  ngWords: string[]
}

export interface SurveyDesign {
  intro: string
  thanksMessage: string
}

/** 編集中の下書きと公開版で共通の中身 */
export interface SurveyContent {
  questions: Question[]
  redirectRule: RedirectRule
  reviewDraftSettings: ReviewDraftSettings
  design: SurveyDesign
}

export type AnswerValue = number | string | string[]
export type Answers = Record<string, AnswerValue>

export interface PublishPeriod {
  startAt: Date | null
  endAt: Date | null
}
