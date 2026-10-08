import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { isWithinPeriod, parseOptionalDate, requirePublishPeriod, toPeriod } from '../period'

const invalid = { code: 'invalid-argument' }

test('requirePublishPeriod: 未指定は null、ISO 文字列は Date にする', () => {
  assert.deepEqual(requirePublishPeriod({ startAt: null, endAt: null }), { startAt: null, endAt: null })
  assert.deepEqual(requirePublishPeriod({}), { startAt: null, endAt: null })
  assert.deepEqual(
    requirePublishPeriod({ startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-31T15:00:00.000Z' }),
    { startAt: new Date('2026-10-01T00:00:00.000Z'), endAt: new Date('2026-10-31T15:00:00.000Z') },
  )
})

test('requirePublishPeriod: 終了は開始より後。日時の形式が誤りなら拒否', () => {
  assert.throws(
    () => requirePublishPeriod({ startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-02T00:00:00Z' }),
    { code: 'invalid-argument', message: '終了日時は開始日時より後にしてください。' },
  )
  assert.throws(() => requirePublishPeriod({ startAt: 'あした', endAt: null }), { message: '公開期間の日時の形式が正しくありません。' })
  assert.throws(() => requirePublishPeriod({ startAt: '', endAt: null }), invalid)
  assert.throws(() => requirePublishPeriod({ startAt: 1, endAt: null }), invalid)
  assert.throws(() => requirePublishPeriod(null), invalid)
})

test('parseOptionalDate: null / undefined は null', () => {
  assert.equal(parseOptionalDate(undefined, '期間'), null)
  assert.equal(parseOptionalDate(null, '期間'), null)
  assert.throws(() => parseOptionalDate('x', '期間'), { message: '期間の日時の形式が正しくありません。' })
})

test('toPeriod: Timestamp・Date・未設定を Date | null にする', () => {
  const start = new Date('2026-10-01T00:00:00.000Z')
  assert.deepEqual(toPeriod({ startAt: Timestamp.fromDate(start), endAt: null }), { startAt: start, endAt: null })
  assert.deepEqual(toPeriod({ startAt: start, endAt: start }), { startAt: start, endAt: start })
  assert.deepEqual(toPeriod(undefined), { startAt: null, endAt: null })
})

test('isWithinPeriod: 開始前・終了後は期間外。開始・終了ちょうどは期間内', () => {
  const now = new Date('2026-10-08T01:00:00.000Z')
  const at = (ms: number) => new Date(now.getTime() + ms)
  assert.equal(isWithinPeriod({ startAt: null, endAt: null }, now), true)
  assert.equal(isWithinPeriod({ startAt: now, endAt: now }, now), true)
  assert.equal(isWithinPeriod({ startAt: at(1), endAt: null }, now), false)
  assert.equal(isWithinPeriod({ startAt: null, endAt: at(-1) }, now), false)
})
