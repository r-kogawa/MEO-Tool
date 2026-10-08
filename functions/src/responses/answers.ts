import { fail } from '../shared/errors'
import { asObject } from '../shared/validation'
import type { AnswerValue, Answers, Question } from '../surveys/types'

// F-10 回答の検証（モック app/utils/mock/functions/responses.ts の validateAnswers を移し、選択肢 ID の確認を加えた）

export const MAX_TEXT_LENGTH = 500

function invalid(message: string): never {
  return fail('invalid-argument', message)
}

function hasOption(question: Question, id: unknown): boolean {
  return typeof id === 'string' && question.options.some(option => option.id === id)
}

/** 1 問分の回答を検証し、保存する値を返す。未回答は undefined */
function readAnswer(question: Question, value: unknown): AnswerValue | undefined {
  if (value === undefined || value === null) return undefined
  switch (question.type) {
    case 'rating':
    case 'nps': {
      const [min, max] = question.type === 'rating' ? [1, 5] : [0, 10]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid('評価の値が不正です。')
      return value
    }
    case 'single': {
      if (value === '') return undefined
      if (!hasOption(question, value)) invalid('選択肢の値が不正です。')
      return value as string
    }
    case 'multi': {
      if (!Array.isArray(value) || !value.every(id => hasOption(question, id))) invalid('選択肢の値が不正です。')
      const ids = [...new Set(value as string[])]
      return ids.length > 0 ? ids : undefined
    }
    case 'text': {
      if (typeof value !== 'string') invalid('自由記述の値が不正です。')
      const text = value.trim()
      if (text.length > MAX_TEXT_LENGTH) invalid(`自由記述は ${MAX_TEXT_LENGTH} 文字以内で入力してください。`)
      // 空白だけの回答は未回答として扱う
      return text === '' ? undefined : text
    }
  }
}

/**
 * 公開版の設問で回答を検証し、保存する回答を返す。
 * 公開版に無い設問 ID の回答（回答中に変更が公開された場合など）は捨てる
 */
export function requireAnswers(questions: Question[], value: unknown): Answers {
  const input = asObject(value)
  const answers: Answers = {}
  for (const question of questions) {
    const answer = readAnswer(question, input[question.id])
    if (answer === undefined) {
      if (question.isRequired) invalid(`「${question.label}」は必須です。`)
      continue
    }
    answers[question.id] = answer
  }
  return answers
}
