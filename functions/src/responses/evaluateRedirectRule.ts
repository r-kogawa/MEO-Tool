import type { AnswerValue, Answers, RedirectCondition, RedirectRule } from '../surveys/types'

// F-11 遷移ルールの判定（app/utils/evaluateRedirectRule.ts から移した。モックは引き続き app 側を使う）。
// 回答画面には遷移ルールを渡さないため、判定は postSurveyResponse だけで行う

function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === '') return true
  return Array.isArray(value) && value.length === 0
}

function evaluateCondition(condition: RedirectCondition, answers: Answers): boolean {
  const answer = answers[condition.questionId]
  if (condition.comparator === 'notEmpty') return !isEmptyAnswer(answer)
  // 未回答の設問を参照する条件は満たさない扱い
  if (isEmptyAnswer(answer) || answer === undefined) return false

  const expected = condition.value
  switch (condition.comparator) {
    case 'eq':
      return answer === expected
    case 'neq':
      return answer !== expected
    case 'gte':
      return typeof answer === 'number' && typeof expected === 'number' && answer >= expected
    case 'lte':
      return typeof answer === 'number' && typeof expected === 'number' && answer <= expected
    case 'includes':
      return Array.isArray(answer) ? answer.includes(String(expected)) : answer === expected
    case 'notIncludes':
      return Array.isArray(answer) ? !answer.includes(String(expected)) : answer !== expected
  }
}

export function evaluateRedirectRule(rule: RedirectRule, answers: Answers): boolean {
  if (rule.conditions.length === 0) return false
  const results = rule.conditions.map(condition => evaluateCondition(condition, answers))
  return rule.operator === 'and' ? results.every(Boolean) : results.some(Boolean)
}
