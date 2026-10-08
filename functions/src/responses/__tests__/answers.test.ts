import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Question } from '../../surveys/types'
import { requireAnswers } from '../answers'
import { evaluateRedirectRule } from '../evaluateRedirectRule'

const QUESTIONS: Question[] = [
  { id: 'q-rating', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
  { id: 'q-nps', type: 'nps', label: 'おすすめ度', isRequired: false, options: [], useForReviewDraft: false },
  {
    id: 'q-single',
    type: 'single',
    label: '来店回数',
    isRequired: false,
    options: [{ id: 'o-first', label: '初めて' }, { id: 'o-repeat', label: '2 回以上' }],
    useForReviewDraft: false,
  },
  {
    id: 'q-multi',
    type: 'multi',
    label: '良かった点',
    isRequired: false,
    options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
    useForReviewDraft: true,
  },
  { id: 'q-text', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
]
const RATED = { 'q-rating': 5 }

test('requireAnswers: 正しい回答を返す（自由記述は前後の空白を除き、複数選択の重複は 1 つに）', () => {
  assert.deepEqual(
    requireAnswers(QUESTIONS, { 'q-rating': 5, 'q-nps': 0, 'q-single': 'o-first', 'q-multi': ['o-taste', 'o-taste', 'o-service'], 'q-text': ' おいしかった ' }),
    { 'q-rating': 5, 'q-nps': 0, 'q-single': 'o-first', 'q-multi': ['o-taste', 'o-service'], 'q-text': 'おいしかった' },
  )
})

test('requireAnswers: 必須の設問が未回答なら「必須です」', () => {
  assert.throws(() => requireAnswers(QUESTIONS, {}), { code: 'invalid-argument', message: '「満足度」は必須です。' })
  assert.throws(() => requireAnswers(QUESTIONS, { 'q-rating': null }), { message: '「満足度」は必須です。' })
})

test('requireAnswers: 評価は 1〜5、おすすめ度は 0〜10 の整数', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { 'q-rating': 1, 'q-nps': 10 }), { 'q-rating': 1, 'q-nps': 10 })
  for (const value of [0, 6, 4.5, '5']) {
    assert.throws(() => requireAnswers(QUESTIONS, { 'q-rating': value }), { code: 'invalid-argument', message: '評価の値が不正です。' })
  }
  for (const value of [-1, 11]) {
    assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-nps': value }), { message: '評価の値が不正です。' })
  }
})

test('requireAnswers: 選択肢の ID は公開版にあるものだけ', () => {
  const error = { code: 'invalid-argument', message: '選択肢の値が不正です。' }
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-single': 'o-none' }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-single': ['o-first'] }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-multi': ['o-taste', 'o-none'] }), error)
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-multi': 'o-taste' }), error)
})

test('requireAnswers: 自由記述は 500 文字まで（501 文字は拒否）', () => {
  assert.equal(requireAnswers(QUESTIONS, { ...RATED, 'q-text': 'あ'.repeat(500) })['q-text'], 'あ'.repeat(500))
  assert.throws(
    () => requireAnswers(QUESTIONS, { ...RATED, 'q-text': 'あ'.repeat(501) }),
    { code: 'invalid-argument', message: '自由記述は 500 文字以内で入力してください。' },
  )
  assert.throws(() => requireAnswers(QUESTIONS, { ...RATED, 'q-text': 123 }), { message: '自由記述の値が不正です。' })
})

test('requireAnswers: 空白だけの自由記述・空の複数選択は未回答として扱う（Review Focus 3）', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { ...RATED, 'q-text': ' \n　', 'q-multi': [], 'q-single': '' }), RATED)
  const requiredText: Question[] = [{ ...QUESTIONS[4]!, isRequired: true }]
  assert.throws(() => requireAnswers(requiredText, { 'q-text': '   ' }), { message: '「ご感想」は必須です。' })
  // 「回答がある」の条件も満たさない
  const notEmpty = { operator: 'and' as const, conditions: [{ id: 'c-1', questionId: 'q-text', comparator: 'notEmpty' as const, value: null }] }
  assert.equal(evaluateRedirectRule(notEmpty, requireAnswers(QUESTIONS, { ...RATED, 'q-text': '  ' })), false)
})

test('requireAnswers: 公開版に無い設問 ID の回答は捨てて受け付ける（Review Focus 4）', () => {
  assert.deepEqual(requireAnswers(QUESTIONS, { ...RATED, 'q-deleted': 3, 'q-old-text': 'x' }), RATED)
})

test('requireAnswers: 回答がオブジェクトでなければ拒否', () => {
  assert.throws(() => requireAnswers(QUESTIONS, null), { code: 'invalid-argument' })
  assert.throws(() => requireAnswers(QUESTIONS, [5]), { code: 'invalid-argument' })
})
