import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRateLimitHits } from '../rateLimit'

const NOW = new Date('2026-10-08T01:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const TEN_MINUTES = 10 * 60 * 1000
const limited = { code: 'resource-exhausted', message: '短時間に多くの回答が送られました。しばらくしてから再度お試しください。' }

test('nextRateLimitHits: 10 分以内が 4 件までなら今回を加えて返す（5 件目は通る）', () => {
  assert.deepEqual(nextRateLimitHits([], NOW), [NOW])
  const four = [ago(4000), ago(3000), ago(2000), ago(1000)]
  assert.deepEqual(nextRateLimitHits(four, NOW), [...four, NOW])
})

test('nextRateLimitHits: 10 分以内が 5 件あれば拒否する（6 件目）', () => {
  assert.throws(() => nextRateLimitHits([5, 4, 3, 2, 1].map(n => ago(n * 1000)), NOW), limited)
})

test('nextRateLimitHits: 10 分より古い受付は数えずに捨てる（ちょうど 10 分前は数える）', () => {
  const old = ago(TEN_MINUTES + 1)
  const edge = ago(TEN_MINUTES)
  assert.deepEqual(nextRateLimitHits([old, edge], NOW), [edge, NOW])
  assert.deepEqual(nextRateLimitHits([old, old, old, old, old], NOW), [NOW])
  assert.throws(() => nextRateLimitHits([edge, ago(4), ago(3), ago(2), ago(1)], NOW), limited)
})
