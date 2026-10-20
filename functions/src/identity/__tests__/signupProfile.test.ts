import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignupProfileInput } from '../signupProfile'

const base = { phone: '090-1234-5678', industry: 'salon', storeCount: '3-5' }
const EMPTY_SOURCE = { utmSource: null, utmMedium: null, utmCampaign: null, ref: null, landingPath: null, capturedAt: null }

test('3 項目を読み、source が無ければ null', () => {
  assert.deepEqual(parseSignupProfileInput(base), { phone: '09012345678', industry: 'salon', storeCount: '3-5', source: null })
})

test('選択肢にない業種・店舗数、欠落は invalid-argument', () => {
  assert.throws(() => parseSignupProfileInput({ ...base, industry: 'restaurant' }), { code: 'invalid-argument', message: '業種の値が正しくありません。' })
  assert.throws(() => parseSignupProfileInput({ ...base, storeCount: '3' }), { code: 'invalid-argument', message: '運営店舗数の値が正しくありません。' })
  assert.throws(() => parseSignupProfileInput({ phone: base.phone, industry: 'salon' }), { code: 'invalid-argument' })
})

test('source: 空・null は null にそろえ、全部空なら source ごと null。知らないキーは無視', () => {
  assert.equal(parseSignupProfileInput({ ...base, source: null }).source, null)
  assert.equal(parseSignupProfileInput({ ...base, source: { ref: ' ', utmSource: null } }).source, null)
  assert.deepEqual(parseSignupProfileInput({ ...base, source: { ref: ' card-tanaka ', unknown: 'x' } }).source, { ...EMPTY_SOURCE, ref: 'card-tanaka' })
})

test('source: オブジェクト以外・文字列以外の値・上限超えは invalid-argument', () => {
  const error = { code: 'invalid-argument', message: '登録経路の値が正しくありません。' }
  assert.throws(() => parseSignupProfileInput({ ...base, source: 'google' }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: [] }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { ref: 1 } }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { ref: 'a'.repeat(101) } }), error)
  assert.doesNotThrow(() => parseSignupProfileInput({ ...base, source: { landingPath: `/${'a'.repeat(199)}` } }))
  assert.throws(() => parseSignupProfileInput({ ...base, source: { landingPath: `/${'a'.repeat(200)}` } }), error)
  assert.throws(() => parseSignupProfileInput({ ...base, source: { capturedAt: 'a'.repeat(41) } }), error)
})
