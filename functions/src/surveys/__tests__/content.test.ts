import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireSurveyContent, validateSurveyForPublish } from '../content'
import type { SurveyContent } from '../types'
import { sampleContent } from './sampleContent'

const invalid = { code: 'invalid-argument' }
const STORE = { status: 'active', reviewUrl: 'https://search.google.com/local/writereview?placeid=p-1' }

test('requireSurveyContent: 正しい下書きはそのまま返し、知らない項目は捨てる', () => {
  const content = sampleContent()
  assert.deepEqual(requireSurveyContent(content), content)
  const withExtra = { ...sampleContent(), extra: 'x', design: { ...content.design, color: 'red' } }
  assert.deepEqual(requireSurveyContent(withExtra), content)
})

test('requireSurveyContent: 編集途中の空の設問文・選択肢は保存できる', () => {
  const content = sampleContent()
  content.questions[0]!.label = ''
  content.questions[1]!.options[0]!.label = ''
  const saved = requireSurveyContent(content)
  assert.equal(saved.questions[0]!.label, '')
  assert.equal(saved.questions[1]!.options[0]!.label, '')
})

test('requireSurveyContent: 件数と文字数の上限', () => {
  const base = sampleContent()
  const question = base.questions[0]!
  const many = (count: number) => Array.from({ length: count }, (_, index) => ({ ...question, id: `q-${index}` }))
  assert.equal(requireSurveyContent({ ...base, questions: many(20) }).questions.length, 20)
  assert.throws(() => requireSurveyContent({ ...base, questions: many(21) }), { code: 'invalid-argument', message: '設問は 20 問までです。' })
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, label: 'あ'.repeat(101) }] }), { message: '設問文は 100 文字以内にしてください。' })
  const options = Array.from({ length: 11 }, (_, index) => ({ id: `o-${index}`, label: `${index}` }))
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...base.questions[1]!, options }] }), { message: '選択肢は 10 個までです。' })
  assert.throws(
    () => requireSurveyContent({ ...base, questions: [{ ...base.questions[1]!, options: [{ id: 'o-1', label: 'あ'.repeat(41) }] }] }),
    { message: '選択肢は 40 文字以内にしてください。' },
  )
  const conditions = Array.from({ length: 21 }, (_, index) => ({ id: `c-${index}`, questionId: 'q-overall', comparator: 'gte', value: 4 }))
  assert.throws(() => requireSurveyContent({ ...base, redirectRule: { operator: 'and', conditions } }), { message: '遷移条件は 20 件までです。' })
  assert.throws(() => requireSurveyContent({ ...base, design: { intro: 'あ'.repeat(201), thanksMessage: '' } }), { message: '案内文は 200 文字以内にしてください。' })
  const settings = { ...base.reviewDraftSettings, storeHighlights: ['a', 'b', 'c', 'd', 'e', 'f'] }
  assert.throws(() => requireSurveyContent({ ...base, reviewDraftSettings: settings }), { message: '店舗の特徴は 5 件までです。' })
})

test('requireSurveyContent: 形の誤り（種類・比較子・ID・重複 ID・値の型・配列でない）は拒否', () => {
  const base = sampleContent()
  const question = base.questions[0]!
  const rule = (condition: Record<string, unknown>) => ({ ...base, redirectRule: { operator: 'and', conditions: [condition] } })
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, type: 'date' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, id: 'q/1' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [question, question] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: [{ ...question, isRequired: 'yes' }] }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, questions: 'x' }), invalid)
  assert.throws(() => requireSurveyContent({ ...base, redirectRule: { operator: 'xor', conditions: [] } }), invalid)
  assert.throws(() => requireSurveyContent(rule({ id: 'c-1', questionId: 'q-overall', comparator: 'gt', value: 4 })), invalid)
  assert.throws(() => requireSurveyContent(rule({ id: 'c-1', questionId: 'q-overall', comparator: 'gte', value: [4] })), invalid)
  assert.throws(() => requireSurveyContent({ ...base, reviewDraftSettings: { ...base.reviewDraftSettings, tone: 'rude' } }), invalid)
  assert.throws(() => requireSurveyContent(null), invalid)
})

test('validateSurveyForPublish: 正しい内容と有効な店舗なら問題なし', () => {
  assert.deepEqual(validateSurveyForPublish(sampleContent(), STORE), [])
})

test('validateSurveyForPublish: モック（surveys.ts:42-57）と同じ規則', () => {
  const empty: SurveyContent = { ...sampleContent(), questions: [], redirectRule: { operator: 'and', conditions: [] } }
  assert.deepEqual(validateSurveyForPublish(empty, STORE), ['設問を 1 つ以上追加してください。', '遷移条件を 1 つ以上設定してください。'])

  const blank = sampleContent()
  blank.questions[0]!.label = '  '
  assert.deepEqual(validateSurveyForPublish(blank, STORE), ['設問文が空の設問があります。'])

  const choice = sampleContent()
  choice.questions[1]!.options = [choice.questions[1]!.options[0]!]
  assert.deepEqual(validateSurveyForPublish(choice, STORE), ['選択式の設問には選択肢を 2 つ以上設定してください。'])

  const orphan = sampleContent()
  orphan.redirectRule.conditions[0]!.questionId = 'q-deleted'
  assert.deepEqual(validateSurveyForPublish(orphan, STORE), ['遷移条件が削除済みの設問を参照しています。'])

  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, status: 'archived' }), ['店舗がアーカイブされているため公開できません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), null), ['店舗がアーカイブされているため公開できません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, reviewUrl: null }), ['店舗の口コミ URL が設定されていません。'])
  assert.deepEqual(validateSurveyForPublish(sampleContent(), { ...STORE, reviewUrl: '' }), ['店舗の口コミ URL が設定されていません。'])
})
