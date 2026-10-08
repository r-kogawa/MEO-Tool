import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GbpAuthError } from '../errors'
import { toGbpAuthError } from '../createTokenProvider'

/** google-auth-library（gaxios）がトークン更新失敗時に投げるエラーの形 */
function gaxiosError(code: string) {
  return Object.assign(new Error(code), { response: { status: 400, data: { error: code, error_description: 'desc' } } })
}

for (const code of ['invalid_grant', 'invalid_client', 'unauthorized_client']) {
  test(`toGbpAuthError: ${code} は GbpAuthError にする`, () => {
    const converted = toGbpAuthError(gaxiosError(code))
    assert.ok(converted instanceof GbpAuthError)
    assert.equal(converted.reason, code)
  })
}

test('toGbpAuthError: それ以外の OAuth エラーやネットワークエラーはそのまま返す', () => {
  const tempError = gaxiosError('temporarily_unavailable')
  assert.equal(toGbpAuthError(tempError), tempError)
  const network = new TypeError('fetch failed')
  assert.equal(toGbpAuthError(network), network)
})

test('toGbpAuthError: 既に GbpAuthError ならそのまま返す', () => {
  const error = new GbpAuthError('invalid_grant', 'x')
  assert.equal(toGbpAuthError(error), error)
})
