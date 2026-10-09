import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAuthorizedApiKey } from '../externalApi'

test('isAuthorizedApiKey: Bearer のキーが一致するときだけ通す', () => {
  assert.equal(isAuthorizedApiKey('Bearer secret-key', 'secret-key'), true)
  assert.equal(isAuthorizedApiKey('Bearer other-key', 'secret-key'), false)
  assert.equal(isAuthorizedApiKey('Bearer secret-key-long', 'secret-key'), false)
  assert.equal(isAuthorizedApiKey('secret-key', 'secret-key'), false)
  assert.equal(isAuthorizedApiKey('Bearer ', 'secret-key'), false)
  assert.equal(isAuthorizedApiKey(undefined, 'secret-key'), false)
})

test('isAuthorizedApiKey: API キーが未設定なら常に拒否する', () => {
  assert.equal(isAuthorizedApiKey('Bearer ', ''), false)
  assert.equal(isAuthorizedApiKey('Bearer x', ''), false)
})
