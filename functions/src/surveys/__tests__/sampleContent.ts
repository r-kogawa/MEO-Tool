import type { SurveyContent } from '../types'

/** テスト用のアンケート（星評価・複数選択・自由記述。星 4 以上で条件を満たす） */
export function sampleContent(): SurveyContent {
  return {
    questions: [
      { id: 'q-overall', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
      {
        id: 'q-good',
        type: 'multi',
        label: '良かった点',
        isRequired: false,
        options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
        useForReviewDraft: true,
      },
      { id: 'q-comment', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
    ],
    redirectRule: { operator: 'and', conditions: [{ id: 'c-1', questionId: 'q-overall', comparator: 'gte', value: 4 }] },
    reviewDraftSettings: { isEnabled: true, tone: 'polite', length: 'medium', storeHighlights: [], ngWords: ['日本一'] },
    design: { intro: 'ようこそ', thanksMessage: 'ありがとうございました' },
  }
}
