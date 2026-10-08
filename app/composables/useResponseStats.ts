import type { Question, SurveyResponse } from '~/types/domain'

// F-14 / F-18 回答の集計（回答数・条件合致率・遷移率・設問ごとの分布）

export interface QuestionStat {
  question: Question
  answeredCount: number
  /** rating / nps の平均 */
  average: number | null
  /** 値（星の数・選択肢 ID）ごとの件数。表示順に並ぶ */
  distribution: { key: string; label: string; count: number }[]
}

function distributionFor(question: Question, responses: SurveyResponse[]): QuestionStat['distribution'] {
  const count = (predicate: (answer: unknown) => boolean) =>
    responses.filter(response => predicate(response.answers[question.id])).length
  if (question.type === 'rating') {
    return [5, 4, 3, 2, 1].map(value => ({ key: String(value), label: `★${value}`, count: count(answer => answer === value) }))
  }
  if (question.type === 'nps') {
    return [
      { key: 'promoter', label: '推奨（9〜10）', count: count(answer => typeof answer === 'number' && answer >= 9) },
      { key: 'passive', label: '中立（7〜8）', count: count(answer => typeof answer === 'number' && answer >= 7 && answer <= 8) },
      { key: 'detractor', label: '批判（0〜6）', count: count(answer => typeof answer === 'number' && answer <= 6) },
    ]
  }
  if (question.type === 'single' || question.type === 'multi') {
    return question.options.map(option => ({
      key: option.id,
      label: option.label,
      count: count(answer => (Array.isArray(answer) ? answer.includes(option.id) : answer === option.id)),
    }))
  }
  return []
}

export function summarizeResponses(responses: SurveyResponse[]) {
  const eligible = responses.filter(item => item.isEligible).length
  const redirected = responses.filter(item => item.redirectedAt).length
  return { total: responses.length, eligible, redirected }
}

export function useResponseStats(responses: Ref<SurveyResponse[]>, questions: Ref<Question[]>) {
  const summary = computed(() => summarizeResponses(responses.value))

  const questionStats = computed<QuestionStat[]>(() =>
    questions.value.map((question) => {
      const answered = responses.value.filter((response) => {
        const answer = response.answers[question.id]
        return answer !== undefined && answer !== '' && !(Array.isArray(answer) && answer.length === 0)
      })
      const numbers = answered.map(response => response.answers[question.id]).filter((answer): answer is number => typeof answer === 'number')
      return {
        question,
        answeredCount: answered.length,
        average: numbers.length > 0 ? Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10 : null,
        distribution: distributionFor(question, answered),
      }
    }))

  return { summary, questionStats }
}
