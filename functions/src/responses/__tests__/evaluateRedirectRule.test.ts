import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RedirectCondition, RedirectRule } from '../../surveys/types'
import { evaluateRedirectRule } from '../evaluateRedirectRule'

function rule(operator: 'and' | 'or', ...conditions: Omit<RedirectCondition, 'id'>[]): RedirectRule {
  return { operator, conditions: conditions.map((condition, index) => ({ ...condition, id: `c-${index}` })) }
}

const one = (condition: Omit<RedirectCondition, 'id'>) => rule('and', condition)

test('演算子 7 種', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'eq', value: 5 }), { q: 5 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'eq', value: 5 }), { q: 4 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), { q: 4 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), { q: 5 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: 4 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: 3 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'lte', value: 2 }), { q: 2 }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'lte', value: 2 }), { q: 3 }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-a' }), { q: ['o-a', 'o-b'] }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-c' }), { q: ['o-a', 'o-b'] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'includes', value: 'o-a' }), { q: 'o-a' }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-c' }), { q: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), { q: ['o-a'] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), { q: 'よかった' }), true)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), {}), false)
})

test('and はすべて、or はいずれかを満たせば true', () => {
  const high = { questionId: 'q1', comparator: 'gte', value: 4 } as const
  const good = { questionId: 'q2', comparator: 'includes', value: 'o-a' } as const
  assert.equal(evaluateRedirectRule(rule('and', high, good), { q1: 5, q2: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(rule('and', high, good), { q1: 5, q2: ['o-b'] }), false)
  assert.equal(evaluateRedirectRule(rule('or', high, good), { q1: 1, q2: ['o-a'] }), true)
  assert.equal(evaluateRedirectRule(rule('or', high, good), { q1: 1, q2: ['o-b'] }), false)
})

test('条件 0 件は false', () => {
  assert.equal(evaluateRedirectRule(rule('and'), { q: 5 }), false)
  assert.equal(evaluateRedirectRule(rule('or'), { q: 5 }), false)
})

test('未回答の設問を参照する条件は満たさない（neq・notIncludes・空配列でも）', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'neq', value: 5 }), {}), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), {}), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notIncludes', value: 'o-a' }), { q: [] }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'notEmpty', value: null }), { q: '' }), false)
})

test('gte / lte は数値でない回答・値を満たさない', () => {
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: 4 }), { q: '5' }), false)
  assert.equal(evaluateRedirectRule(one({ questionId: 'q', comparator: 'gte', value: '4' }), { q: 5 }), false)
})
