import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/https'
import { runBatch } from '../runBatch'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('runBatch: 同時実行数を守り、成功は入力順で返す', async () => {
  let running = 0
  let maxRunning = 0
  const result = await runBatch([30, 10, 20, 5, 15], item => `id-${item}`, async (item) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await wait(item)
    running--
  }, { concurrency: 2 })

  assert.equal(maxRunning, 2)
  assert.deepEqual(result.succeeded, ['id-30', 'id-10', 'id-20', 'id-5', 'id-15'])
  assert.deepEqual(result.failed, [])
})

test('runBatch: 失敗した項目は理由付きで failed に入れ、他は続ける', async () => {
  const result = await runBatch(['a', 'b', 'c'], item => item, async (item) => {
    if (item === 'b') throw new HttpsError('unavailable', 'Google ビジネスプロフィールでエラーが発生しました: denied')
  })

  assert.deepEqual(result.succeeded, ['a', 'c'])
  assert.deepEqual(result.failed, [{ id: 'b', message: 'Google ビジネスプロフィールでエラーが発生しました: denied' }])
})

test('runBatch: Error 以外の例外は汎用メッセージ、空配列は空の結果', async () => {
  const result = await runBatch(['x'], item => item, async () => { throw 'boom' })
  assert.deepEqual(result.failed, [{ id: 'x', message: '処理に失敗しました。' }])
  assert.deepEqual(await runBatch([], item => item, async () => {}), { succeeded: [], failed: [] })
})
