import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextOperatorClaims } from '../operatorClaims'

test('nextOperatorClaims: 既存の claims を保ったまま operator を付け外しする', () => {
  assert.deepEqual(nextOperatorClaims(undefined, false), { operator: true })
  assert.deepEqual(nextOperatorClaims({ plan: 'x' }, false), { plan: 'x', operator: true })
  assert.deepEqual(nextOperatorClaims({ plan: 'x', operator: true }, true), { plan: 'x' })
  assert.deepEqual(nextOperatorClaims(undefined, true), {})
})
