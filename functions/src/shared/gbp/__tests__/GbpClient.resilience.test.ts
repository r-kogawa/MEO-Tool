import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GbpApiError } from '../errors'
import { createTestClient } from './helpers'

const LOCATION = 'accounts/1/locations/2'

function timeoutError(): Error {
  return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
}

test('通信エラー: 冪等な GET は再試行し、成功したら結果を返す', async () => {
  const { client, calls, sleeps } = createTestClient([
    { status: 0, throws: new TypeError('fetch failed') },
    { status: 200, body: { accounts: [{ name: 'accounts/1' }] } },
  ])

  const accounts = await client.listAccounts()

  assert.equal(accounts.length, 1)
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [500])
})

test('通信エラー: 再試行の上限を超えたら GbpApiError(status 0, NETWORK_ERROR) に包み、元の例外を cause に残す', async () => {
  const cause = new TypeError('fetch failed')
  const { client, calls } = createTestClient(
    [{ status: 0, throws: cause }, { status: 0, throws: cause }],
    { maxRetries: 1 },
  )

  await assert.rejects(client.listAccounts(), (error: unknown) => {
    assert.ok(error instanceof GbpApiError)
    assert.equal(error.status, 0)
    assert.equal(error.reason, 'NETWORK_ERROR')
    assert.equal(error.cause, cause)
    return true
  })
  assert.equal(calls.length, 2)
})

test('通信エラー: 冪等でない POST は再試行せず GbpApiError に包む', async () => {
  const { client, calls } = createTestClient([{ status: 0, throws: new TypeError('fetch failed') }])

  await assert.rejects(
    client.createLocalPost(LOCATION, { languageCode: 'ja', summary: 'a', topicType: 'STANDARD' }),
    { name: 'GbpApiError', status: 0, reason: 'NETWORK_ERROR' },
  )
  assert.equal(calls.length, 1)
})

test('タイムアウト: reason を TIMEOUT にする', async () => {
  const { client } = createTestClient([{ status: 0, throws: timeoutError() }], { maxRetries: 0 })
  await assert.rejects(client.listAccounts(), { name: 'GbpApiError', status: 0, reason: 'TIMEOUT' })
})

test('タイムアウト: すべてのリクエストに AbortSignal を付ける', async () => {
  const { client, calls } = createTestClient([{ status: 200, body: {} }])
  await client.listAccounts()
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('DELETE: 再試行後の 404 は「前回の試行で削除済み」として成功扱い', async () => {
  const { client, calls } = createTestClient([
    { status: 503, body: '' },
    { status: 404, body: { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } } },
  ])

  await client.deleteLocalPost(`${LOCATION}/localPosts/p1`)

  assert.equal(calls.length, 2)
})

test('DELETE: 初回の 404 は GbpApiError のまま（存在しないものの削除）', async () => {
  const { client } = createTestClient([
    { status: 404, body: { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } } },
  ])
  await assert.rejects(client.deleteReviewReply(`${LOCATION}/reviews/r1`), { name: 'GbpApiError', status: 404 })
})
