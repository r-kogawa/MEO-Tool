import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallableRequest } from 'firebase-functions/https'
import { requireCaller, requireOperator } from '../auth'

const request = (token: Record<string, unknown>) => ({ auth: { uid: 'u-1', token } }) as unknown as CallableRequest<unknown>

test('requireCaller: claims の operator が true のときだけ isOperator', () => {
  assert.equal(requireCaller(request({ email: 'A@Example.com', operator: true })).isOperator, true)
  assert.equal(requireCaller(request({ operator: 'true' })).isOperator, false)
  assert.equal(requireCaller(request({})).isOperator, false)
  assert.equal(requireCaller(request({ email: 'A@Example.com' })).email, 'a@example.com')
})

test('requireOperator: 運営者でなければ permission-denied', () => {
  assert.doesNotThrow(() => requireOperator({ uid: 'u', email: '', isOperator: true }))
  assert.throws(() => requireOperator({ uid: 'u', email: '', isOperator: false }), { code: 'permission-denied', message: '運営権限がありません。' })
})
