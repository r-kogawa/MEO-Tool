import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIpOf } from '../callable'

test('clientIpOf: rawRequest.ip を返し、とれなければ null', () => {
  assert.equal(clientIpOf({ ip: '203.0.113.1' }), '203.0.113.1')
  assert.equal(clientIpOf({ ip: '' }), null)
  assert.equal(clientIpOf({}), null)
  assert.equal(clientIpOf(undefined), null)
})
