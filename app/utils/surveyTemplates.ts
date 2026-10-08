import type { Question, QuestionType, SurveyContent } from '~/types/domain'

// F-06 アンケートのテンプレートと、設問の初期値

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  rating: '星評価（1〜5）',
  nps: 'おすすめ度（0〜10）',
  single: '単一選択',
  multi: '複数選択',
  text: '自由記述',
}

export const QUESTION_LIMIT = 20
export const OPTION_LIMIT = 10

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function createQuestion(type: QuestionType): Question {
  const isChoice = type === 'single' || type === 'multi'
  return {
    id: newId('q'),
    type,
    label: '',
    isRequired: type === 'rating' || type === 'nps',
    options: isChoice
      ? [{ id: newId('o'), label: '選択肢 1' }, { id: newId('o'), label: '選択肢 2' }]
      : [],
    useForReviewDraft: type !== 'nps',
  }
}

const DEFAULT_DESIGN = {
  intro: 'ご来店ありがとうございます。今後のサービス向上のため、1 分ほどのアンケートにご協力ください。',
  thanksMessage: 'ご回答ありがとうございました。またのご来店をお待ちしております。',
}

/** 標準テンプレート（総合満足度・良かった点・おすすめ度・自由記述） */
export function createStandardContent(tasteLabel = '料理の味', highlights: string[] = []): SurveyContent {
  return {
    questions: [
      { id: 'q-overall', type: 'rating', label: '本日のご来店の満足度を教えてください', isRequired: true, options: [], useForReviewDraft: true },
      {
        id: 'q-good',
        type: 'multi',
        label: '良かった点を教えてください（複数選択可）',
        isRequired: false,
        options: [
          { id: 'o-taste', label: tasteLabel },
          { id: 'o-service', label: '接客' },
          { id: 'o-atmosphere', label: '店内の雰囲気' },
          { id: 'o-price', label: '価格' },
          { id: 'o-speed', label: '提供の速さ' },
        ],
        useForReviewDraft: true,
      },
      { id: 'q-recommend', type: 'nps', label: '友人・知人にすすめる可能性はどのくらいありますか', isRequired: true, options: [], useForReviewDraft: false },
      { id: 'q-comment', type: 'text', label: 'ご感想があればご自由にお書きください', isRequired: false, options: [], useForReviewDraft: true },
    ],
    redirectRule: {
      operator: 'and',
      conditions: [{ id: 'c-overall', questionId: 'q-overall', comparator: 'gte', value: 4 }],
    },
    reviewDraftSettings: {
      isEnabled: true,
      tone: 'polite',
      length: 'medium',
      storeHighlights: highlights,
      ngWords: ['日本一', '最高級'],
    },
    design: { ...DEFAULT_DESIGN },
  }
}

/** 空のテンプレート。総合評価の設問と既定の遷移条件だけを持つ */
export function createBlankContent(): SurveyContent {
  const overall: Question = { ...createQuestion('rating'), label: '本日のご来店の満足度を教えてください' }
  return {
    questions: [overall],
    redirectRule: { operator: 'and', conditions: [{ id: newId('c'), questionId: overall.id, comparator: 'gte', value: 4 }] },
    reviewDraftSettings: { isEnabled: true, tone: 'polite', length: 'medium', storeHighlights: [], ngWords: [] },
    design: { ...DEFAULT_DESIGN },
  }
}

export const SURVEY_TEMPLATES = [
  { id: 'standard', label: '標準テンプレート', description: '総合満足度・良かった点・おすすめ度・自由記述の 4 問', create: () => createStandardContent() },
  { id: 'blank', label: '空のテンプレート', description: '総合満足度の 1 問から自由に組み立てる', create: createBlankContent },
] as const
