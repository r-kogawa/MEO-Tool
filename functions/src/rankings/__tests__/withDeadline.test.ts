import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withDeadline } from '../providers/gmapsScraper'
import { RankProviderError } from '../providers/rankProvider'

test('withDeadline: 期限内に終われば結果を返す', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 1000), 'ok')
})

test('withDeadline: 期限を過ぎたら timeout の RankProviderError にする', async () => {
  const never = new Promise<string>(() => undefined)
  await assert.rejects(withDeadline(never, 20), (error: unknown) => error instanceof RankProviderError && error.code === 'timeout')
})

test('withDeadline: 期限内の失敗はそのまま投げる', async () => {
  await assert.rejects(withDeadline(Promise.reject(new RankProviderError('blocked', 'x')), 1000), (error: unknown) => error instanceof RankProviderError && error.code === 'blocked')
})
