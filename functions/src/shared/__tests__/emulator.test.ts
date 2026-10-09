import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFullyEmulated } from '../emulator'

test('isFullyEmulated: Functions Emulator かつ Firestore Emulator のときだけ true', () => {
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), true)
})

test('isFullyEmulated: Functions Emulator だけ（データは本番）なら false', () => {
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(isFullyEmulated({ FUNCTIONS_EMULATOR: 'true', FIRESTORE_EMULATOR_HOST: '' }), false)
})

test('isFullyEmulated: Functions Emulator でなければ false', () => {
  assert.equal(isFullyEmulated({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), false)
  assert.equal(isFullyEmulated({}), false)
})
