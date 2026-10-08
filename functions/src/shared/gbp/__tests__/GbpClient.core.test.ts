import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GbpApiError } from '../errors'
import { createTestClient } from './helpers'

const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'

test('listAccounts: Bearer トークンを付けて全ページを取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { accounts: [{ name: 'accounts/1' }], nextPageToken: 'p2' } },
    { status: 200, body: { accounts: [{ name: 'accounts/2' }] } },
  ])

  const accounts = await client.listAccounts()

  assert.deepEqual(accounts.map(a => a.name), ['accounts/1', 'accounts/2'])
  assert.equal(calls[0].url, `${ACCOUNTS_URL}?pageSize=20`)
  assert.equal(calls[1].url, `${ACCOUNTS_URL}?pageSize=20&pageToken=p2`)
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1')
  assert.equal(calls[0].method, 'GET')
})

test('listAccounts: accounts が無い応答は空配列', async () => {
  const { client } = createTestClient([{ status: 200, body: {} }])
  assert.deepEqual(await client.listAccounts(), [])
})

test('429 と 503 は指数バックオフで再試行し、成功したら結果を返す', async () => {
  const { client, calls, sleeps } = createTestClient([
    { status: 429, body: { error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } } },
    { status: 503, body: 'Service Unavailable' },
    { status: 200, body: { accounts: [{ name: 'accounts/1' }] } },
  ])

  const accounts = await client.listAccounts()

  assert.equal(accounts.length, 1)
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [500, 1000])
})

test('再試行でトークン再取得: 試行ごとに getAccessToken を呼ぶ', async () => {
  const { client, calls } = createTestClient([
    { status: 500, body: '' },
    { status: 200, body: { accounts: [] } },
  ])

  await client.listAccounts()

  assert.equal(calls[0].headers.Authorization, 'Bearer token-1')
  assert.equal(calls[1].headers.Authorization, 'Bearer token-2')
})

test('再試行の上限を超えたら GbpApiError（最後の応答のステータス）', async () => {
  const { client, calls } = createTestClient(
    [{ status: 503, body: '' }, { status: 503, body: '' }, { status: 503, body: '' }],
    { maxRetries: 2 },
  )

  await assert.rejects(client.listAccounts(), (error: unknown) => {
    assert.ok(error instanceof GbpApiError)
    assert.equal(error.status, 503)
    return true
  })
  assert.equal(calls.length, 3)
})

test('4xx は再試行せず、Google のエラー本文から reason と message を取る', async () => {
  const { client, calls } = createTestClient([
    {
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
    },
  ])

  await assert.rejects(client.listAccounts(), (error: unknown) => {
    assert.ok(error instanceof GbpApiError)
    assert.equal(error.status, 403)
    assert.equal(error.reason, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    assert.equal(error.message, 'The caller does not have permission')
    return true
  })
  assert.equal(calls.length, 1)
})

test('ErrorInfo が無いときは error.status を reason にする', async () => {
  const { client } = createTestClient([
    { status: 400, body: { error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' } } },
  ])
  await assert.rejects(client.listAccounts(), { name: 'GbpApiError', reason: 'INVALID_ARGUMENT' })
})

test('JSON でないエラー本文: reason は null、message に HTTP ステータスを入れる', async () => {
  const { client } = createTestClient([{ status: 404, body: '<html>Not Found</html>' }])
  await assert.rejects(client.listAccounts(), (error: unknown) => {
    assert.ok(error instanceof GbpApiError)
    assert.equal(error.reason, null)
    assert.match(error.message, /404/)
    return true
  })
})
