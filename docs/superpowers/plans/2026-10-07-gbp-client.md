# GBP クライアントクラス Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Business Profile の 3 つの API（Account Management v1 / Business Information v1 / v4）を 1 クラスで扱う、Firebase 非依存の汎用クライアント `GbpClient` を `functions/src/shared/gbp/` に作る。

**Architecture:** Node 標準 `fetch` で REST を直接呼ぶ薄いクラス。アクセストークンは `getAccessToken` 関数を外から注入し、トークンの保管方法に依存しない。429 / 5xx は指数バックオフで再試行し、それ以外は `GbpApiError`、OAuth の失効は `GbpAuthError` に分類する。一括処理の制御は持たない。

**Tech Stack:** TypeScript 6（CommonJS / `module: NodeNext`）、Node 標準 `fetch`、`google-auth-library`、テストは `node:test` + `node:assert/strict`

**Spec:** `docs/superpowers/specs/2026-10-07-gbp-integration-design.md`（2 章）

## Global Constraints

- `functions/src/shared/gbp/` 配下から **`firebase-*` とプロジェクト固有コード（`../` より上）を import しない**。外部依存は `google-auth-library` のみ
- 1 メソッド = API 1 呼び出し（`list*` の全ページ取得系を除く）。一括処理の制御（並列数・件数上限・部分失敗の集計）は持たない
- 再試行対象は HTTP 429 / 500 / 502 / 503 / 504。既定は最大 3 回、初回待機 500ms の指数バックオフ（500 → 1000 → 2000ms）
- OAuth のエラーコード `invalid_grant` / `invalid_client` / `unauthorized_client` は `GbpAuthError`（再試行しない）
- ホスト: `https://mybusinessaccountmanagement.googleapis.com/v1` / `https://mybusinessbusinessinformation.googleapis.com/v1` / `https://mybusiness.googleapis.com/v4`
- ページサイズ: accounts 20 / locations 100 / reviews 50 / localPosts 100（各 API の上限）
- 既存の `functions/src/index.ts` と `npm run build`（`tsc`）の出力内容を変えない。テストファイルは `lib/` に出力しない
- コミットはユーザーの許可がある場合のみ行う（`main` に未コミットの作業があるため、実行時はブランチ / worktree で行う）

## Review Focus

- **空ボディの成功応答**（`DELETE` の 200 / 204 で本文なし）: 例外にせず `undefined` 相当で正常終了する → Task 1 のテスト「空ボディ」
- **Google 形式でないエラー本文**（HTML や空文字の 502 など）: JSON パースで落ちず、`GbpApiError` の `reason` が `null`、`message` に HTTP ステータスが入る → Task 1 のテスト「JSON でないエラー本文」
- **再試行のたびにトークンを取り直す**: 待機中にトークンが期限切れになっても次の試行で新しいトークンを使う → Task 1 のテスト「再試行でトークン再取得」
- **空の `updateMask`**: 何も更新しない PATCH を Google に送らず、呼び出し前に例外にする → Task 2 のテスト
- **形式違いのリソース名**（`toV4LocationPath` に `locations/...` 以外や `accounts/1/locations/2` を渡す）: 不正な URL を組み立てずに例外にする → Task 3 のテスト

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `functions/src/shared/gbp/errors.ts` | `GbpApiError` / `GbpAuthError` |
| `functions/src/shared/gbp/types.ts` | API のリソース型と `AccessTokenProvider` / `GbpClientOptions` |
| `functions/src/shared/gbp/utils.ts` | `toV4LocationPath` / `starRatingToNumber`（API 呼び出しを伴わない変換） |
| `functions/src/shared/gbp/GbpClient.ts` | HTTP 呼び出し・再試行・ページング・各 API メソッド |
| `functions/src/shared/gbp/createTokenProvider.ts` | refresh token → access token、OAuth エラーの分類 |
| `functions/src/shared/gbp/index.ts` | 公開 export |
| `functions/src/shared/gbp/__tests__/helpers.ts` | テスト用の偽 `fetch` と `GbpClient` 生成 |
| `functions/src/shared/gbp/__tests__/*.test.ts` | 単体テスト |
| `functions/tsconfig.json` | `__tests__` を本番ビルドから除外 |
| `functions/tsconfig.test.json` | テスト用ビルド（出力先 `lib-test/`） |
| `functions/package.json` | `google-auth-library` 追加、`test` スクリプト |
| `functions/.gitignore` / `firebase.json` | `lib-test/` を除外 |

---

### Task 1: テスト基盤・エラー型・HTTP コア（`listAccounts`）

**Files:**
- Modify: `functions/tsconfig.json`
- Create: `functions/tsconfig.test.json`
- Modify: `functions/package.json`（`scripts.test`）
- Modify: `functions/.gitignore`、`firebase.json`（`functions[0].ignore`）
- Create: `functions/src/shared/gbp/errors.ts`
- Create: `functions/src/shared/gbp/types.ts`
- Create: `functions/src/shared/gbp/GbpClient.ts`
- Create: `functions/src/shared/gbp/__tests__/helpers.ts`
- Test: `functions/src/shared/gbp/__tests__/GbpClient.core.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `class GbpApiError extends Error { readonly status: number; readonly reason: string | null }`
  - `class GbpAuthError extends Error { readonly reason: string }`
  - `type AccessTokenProvider = () => Promise<string>`
  - `interface GbpClientOptions { getAccessToken: AccessTokenProvider; fetch?: typeof fetch; retry?: { maxRetries: number; baseDelayMs: number }; sleep?: (ms: number) => Promise<void> }`
  - `class GbpClient { constructor(options: GbpClientOptions); listAccounts(): Promise<GbpAccount[]> }`
  - `GbpClient` の private: `request<T>(baseUrl: string, path: string, options?: RequestOptions): Promise<T>` / `listAll<TItem, TPage extends { nextPageToken?: string }>(fetchPage: (pageToken?: string) => Promise<TPage>, pick: (page: TPage) => TItem[] | undefined): Promise<TItem[]>`
  - 定数 `GBP_HOSTS = { accountManagement, businessInformation, v4 }`（`GbpClient.ts` から export）
  - テスト helper: `createTestClient(responses: FakeResponse[], options?: { maxRetries?: number }): { client: GbpClient; calls: FakeCall[]; sleeps: number[]; tokenCalls: () => number }`

- [ ] **Step 1: ベースラインを確認する**

Run: `cd functions && npm run build`
Expected: エラーなしで終了（`lib/index.js` が生成される）

- [ ] **Step 2: テスト用ビルド設定を追加する**

`functions/tsconfig.json` の末尾 `"include"` の後に `exclude` を追加する。

```json
  "include": [
    "src"
  ],
  "exclude": [
    "src/**/__tests__/**"
  ]
```

`functions/tsconfig.test.json` を作成する。

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "lib-test",
    "sourceMap": false
  },
  "include": [
    "src"
  ],
  "exclude": []
}
```

`functions/package.json` の `scripts` に追加する。

```json
    "test": "tsc -p tsconfig.test.json && node --test \"lib-test/**/__tests__/*.test.js\"",
```

`functions/.gitignore` の末尾に追加する。

```
# テスト用ビルド出力
lib-test/
```

`firebase.json` の `functions[0].ignore` 配列に `"lib-test"` を追加する。

```json
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log",
        "*.local",
        "lib-test"
      ],
```

- [ ] **Step 3: エラー型と型定義を作る**

`functions/src/shared/gbp/errors.ts`:

```ts
/** GBP API が 2xx 以外を返した（再試行しても解消しなかった）ときのエラー */
export class GbpApiError extends Error {
  readonly status: number
  /** Google のエラー理由（ErrorInfo.reason または error.status）。取れなければ null */
  readonly reason: string | null

  constructor(status: number, reason: string | null, message: string) {
    super(message)
    this.name = 'GbpApiError'
    this.status = status
    this.reason = reason
  }
}

/** refresh token の失効やクライアント設定の誤りなど、再認証が必要なエラー */
export class GbpAuthError extends Error {
  /** OAuth のエラーコード（invalid_grant など） */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'GbpAuthError'
    this.reason = reason
  }
}
```

`functions/src/shared/gbp/types.ts`（このタスクではアカウントとクライアント設定のみ。他の型は後続タスクで追記する）:

```ts
export type AccessTokenProvider = () => Promise<string>

export interface GbpClientOptions {
  /** 呼び出しごとに有効なアクセストークンを返す関数 */
  getAccessToken: AccessTokenProvider
  /** テストで差し替える。既定は globalThis.fetch */
  fetch?: typeof fetch
  /** 429 / 5xx の再試行設定。既定 { maxRetries: 3, baseDelayMs: 500 } */
  retry?: { maxRetries: number; baseDelayMs: number }
  /** テストで待機を省略するために差し替える */
  sleep?: (ms: number) => Promise<void>
}

export type GbpAccountType = 'ACCOUNT_TYPE_UNSPECIFIED' | 'PERSONAL' | 'LOCATION_GROUP' | 'USER_GROUP' | 'ORGANIZATION'

export interface GbpAccount {
  /** accounts/{accountId} */
  name: string
  accountName?: string
  type?: GbpAccountType
  role?: string
  verificationState?: string
}
```

- [ ] **Step 4: テスト helper を作る**

`functions/src/shared/gbp/__tests__/helpers.ts`:

```ts
import { GbpClient } from '../GbpClient'

export interface FakeResponse {
  status: number
  /** オブジェクトは JSON にする。文字列はそのまま本文にする。undefined は本文なし */
  body?: unknown
}

export interface FakeCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** 用意した応答を順に返す偽 fetch。応答が尽きたら例外にする */
export function createFakeFetch(responses: FakeResponse[]) {
  const queue = [...responses]
  const calls: FakeCall[] = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const next = queue.shift()
    if (!next) throw new Error(`想定外のリクエスト: ${String(input)}`)
    const text = next.body === undefined ? null : typeof next.body === 'string' ? next.body : JSON.stringify(next.body)
    return new Response(text, { status: next.status })
  }) as typeof fetch
  return { fakeFetch, calls }
}

export function createTestClient(responses: FakeResponse[], options: { maxRetries?: number } = {}) {
  const { fakeFetch, calls } = createFakeFetch(responses)
  const sleeps: number[] = []
  let tokenCount = 0
  const client = new GbpClient({
    getAccessToken: async () => `token-${++tokenCount}`,
    fetch: fakeFetch,
    retry: { maxRetries: options.maxRetries ?? 3, baseDelayMs: 500 },
    sleep: async (ms) => { sleeps.push(ms) },
  })
  return { client, calls, sleeps, tokenCalls: () => tokenCount }
}
```

- [ ] **Step 5: 失敗するテストを書く**

`functions/src/shared/gbp/__tests__/GbpClient.core.test.ts`:

```ts
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
```

- [ ] **Step 6: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`tsc` が `Cannot find module '../GbpClient'` で失敗する）

- [ ] **Step 7: `GbpClient` のコアを実装する**

`functions/src/shared/gbp/GbpClient.ts`:

```ts
import { GbpApiError } from './errors'
import type { AccessTokenProvider, GbpAccount, GbpClientOptions } from './types'

export const GBP_HOSTS = {
  accountManagement: 'https://mybusinessaccountmanagement.googleapis.com/v1',
  businessInformation: 'https://mybusinessbusinessinformation.googleapis.com/v1',
  v4: 'https://mybusiness.googleapis.com/v4',
} as const

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const DEFAULT_RETRY = { maxRetries: 3, baseDelayMs: 500 }

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | undefined>

interface RequestOptions {
  method?: HttpMethod
  query?: Query
  body?: unknown
}

interface GoogleErrorBody {
  error?: {
    message?: string
    status?: string
    details?: { '@type'?: string; reason?: string }[]
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildUrl(baseUrl: string, path: string, query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return `${baseUrl}/${path}${search ? `?${search}` : ''}`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}

async function toApiError(response: Response): Promise<GbpApiError> {
  const parsed = parseJson(await response.text()) as GoogleErrorBody | null
  const error = parsed?.error
  const errorInfo = error?.details?.find(detail => detail['@type']?.endsWith('google.rpc.ErrorInfo'))
  const reason = errorInfo?.reason ?? error?.status ?? null
  const message = error?.message ?? `GBP API が HTTP ${response.status} を返しました`
  return new GbpApiError(response.status, reason, message)
}

/**
 * Google Business Profile API の汎用クライアント。
 * Account Management v1 / Business Information v1 / v4（口コミ・投稿）を 1 クラスで扱う。
 * Firebase やプロジェクト固有のコードに依存しないこと（他プロジェクトへ持ち出せるようにする）。
 */
export class GbpClient {
  private readonly getAccessToken: AccessTokenProvider
  private readonly fetchImpl: typeof fetch
  private readonly retry: { maxRetries: number; baseDelayMs: number }
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: GbpClientOptions) {
    this.getAccessToken = options.getAccessToken
    this.fetchImpl = options.fetch ?? fetch
    this.retry = options.retry ?? DEFAULT_RETRY
    this.sleep = options.sleep ?? defaultSleep
  }

  /** 連携した Google アカウントで管理できる GBP アカウントをすべて取得する */
  listAccounts(): Promise<GbpAccount[]> {
    return this.listAll(
      pageToken => this.request<{ accounts?: GbpAccount[]; nextPageToken?: string }>(
        GBP_HOSTS.accountManagement,
        'accounts',
        { query: { pageSize: 20, pageToken } },
      ),
      page => page.accounts,
    )
  }

  /** 1 リクエストを送る。429 / 5xx は指数バックオフで再試行し、試行ごとにトークンを取り直す */
  private async request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(baseUrl, path, options.query)
    const hasBody = options.body !== undefined
    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken()
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
      })
      if (response.ok) {
        const text = await response.text()
        return (text ? JSON.parse(text) : undefined) as T
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.retry.maxRetries) {
        await this.sleep(this.retry.baseDelayMs * 2 ** attempt)
        continue
      }
      throw await toApiError(response)
    }
  }

  /** nextPageToken が無くなるまで取得して 1 つの配列にまとめる */
  private async listAll<TItem, TPage extends { nextPageToken?: string }>(
    fetchPage: (pageToken?: string) => Promise<TPage>,
    pick: (page: TPage) => TItem[] | undefined,
  ): Promise<TItem[]> {
    const items: TItem[] = []
    let pageToken: string | undefined
    do {
      const page = await fetchPage(pageToken)
      items.push(...(pick(page) ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  }
}
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（8 件）

- [ ] **Step 9: 本番ビルドにテストが混ざらないことを確認する**

Run: `cd functions && npm run build && ls lib/shared/gbp`
Expected: `GbpClient.js` `errors.js` `types.js`（と `.map`）のみ。`__tests__` が無い

- [ ] **Step 10: Commit**

```bash
git add functions/tsconfig.json functions/tsconfig.test.json functions/package.json functions/.gitignore firebase.json functions/src/shared/gbp
git commit -m "feat(gbp): GbpClient のコア（再試行・ページング・エラー分類）とテスト基盤を追加"
```

---

### Task 2: プロフィール（Business Information v1）

**Files:**
- Modify: `functions/src/shared/gbp/types.ts`（ロケーション関連の型を追記）
- Modify: `functions/src/shared/gbp/GbpClient.ts`（3 メソッド追加）
- Test: `functions/src/shared/gbp/__tests__/GbpClient.locations.test.ts`

**Interfaces:**
- Consumes: Task 1 の `GbpClient`（private `request` / `listAll`）、`GBP_HOSTS`、`createTestClient`
- Produces:
  - 型 `GbpLocation` / `GbpLocationPatch` / `GbpTimePeriod` / `GbpSpecialHourPeriod` / `GbpTimeOfDay` / `GbpDate` / `GbpDayOfWeek` / `GbpPostalAddress` / `GbpCategory`
  - `listLocations(accountName: string, readMask: string): Promise<GbpLocation[]>`
  - `getLocation(locationName: string, readMask: string): Promise<GbpLocation>`
  - `updateLocation(locationName: string, patch: GbpLocationPatch, updateMask: string[]): Promise<GbpLocation>`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/shared/gbp/__tests__/GbpClient.locations.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestClient } from './helpers'

const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1'

test('listLocations: readMask と pageSize=100 を付けて全ページ取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { locations: [{ name: 'locations/1', title: '渋谷店' }], nextPageToken: 'n' } },
    { status: 200, body: { locations: [{ name: 'locations/2', title: '新宿店' }] } },
  ])

  const locations = await client.listLocations('accounts/9', 'name,title,metadata.placeId')

  assert.deepEqual(locations.map(l => l.title), ['渋谷店', '新宿店'])
  assert.equal(calls[0].url, `${BI}/accounts/9/locations?pageSize=100&readMask=name%2Ctitle%2Cmetadata.placeId`)
  assert.equal(calls[1].url, `${BI}/accounts/9/locations?pageSize=100&pageToken=n&readMask=name%2Ctitle%2Cmetadata.placeId`)
})

test('getLocation: readMask を付けて 1 件取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { name: 'locations/1', profile: { description: '説明' } } },
  ])

  const location = await client.getLocation('locations/1', 'name,profile')

  assert.equal(location.profile?.description, '説明')
  assert.equal(calls[0].url, `${BI}/locations/1?readMask=name%2Cprofile`)
})

test('updateLocation: updateMask をカンマ区切りで付け、patch を JSON で PATCH する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { name: 'locations/1', websiteUri: 'https://example.com' } },
  ])

  const updated = await client.updateLocation(
    'locations/1',
    { websiteUri: 'https://example.com', profile: { description: '新しい説明' } },
    ['websiteUri', 'profile.description'],
  )

  assert.equal(updated.websiteUri, 'https://example.com')
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(calls[0].url, `${BI}/locations/1?updateMask=websiteUri%2Cprofile.description`)
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.deepEqual(calls[0].body, { websiteUri: 'https://example.com', profile: { description: '新しい説明' } })
})

test('updateLocation: updateMask が空なら API を呼ばずに例外', async () => {
  const { client, calls } = createTestClient([])
  await assert.rejects(client.updateLocation('locations/1', {}, []), /updateMask/)
  assert.equal(calls.length, 0)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Property 'listLocations' does not exist on type 'GbpClient'`）

- [ ] **Step 3: 型を追記する**

`functions/src/shared/gbp/types.ts` の末尾に追加する。

```ts
export type GbpDayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** 省略されたフィールドは 0 として扱われる（00:00 は {} で返ることがある） */
export interface GbpTimeOfDay {
  hours?: number
  minutes?: number
}

export interface GbpDate {
  year: number
  month: number
  day: number
}

export interface GbpTimePeriod {
  openDay: GbpDayOfWeek
  openTime: GbpTimeOfDay
  closeDay: GbpDayOfWeek
  closeTime: GbpTimeOfDay
}

export interface GbpSpecialHourPeriod {
  startDate: GbpDate
  openTime?: GbpTimeOfDay
  endDate?: GbpDate
  closeTime?: GbpTimeOfDay
  closed?: boolean
}

export interface GbpPostalAddress {
  regionCode?: string
  postalCode?: string
  administrativeArea?: string
  locality?: string
  addressLines?: string[]
}

export interface GbpCategory {
  name: string
  displayName?: string
}

export interface GbpLocation {
  /** locations/{locationId} */
  name: string
  title?: string
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  categories?: { primaryCategory?: GbpCategory; additionalCategories?: GbpCategory[] }
  storefrontAddress?: GbpPostalAddress
  websiteUri?: string
  regularHours?: { periods: GbpTimePeriod[] }
  specialHours?: { specialHourPeriods: GbpSpecialHourPeriod[] }
  latlng?: { latitude: number; longitude: number }
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string }
  profile?: { description: string }
}

/** updateLocation で送る内容。name と metadata は出力専用のため含めない */
export type GbpLocationPatch = Omit<Partial<GbpLocation>, 'name' | 'metadata'>
```

- [ ] **Step 4: メソッドを実装する**

`functions/src/shared/gbp/GbpClient.ts` の import を差し替える。

```ts
import type { AccessTokenProvider, GbpAccount, GbpClientOptions, GbpLocation, GbpLocationPatch } from './types'
```

`listAccounts()` の直後に追加する。

```ts
  /** アカウント配下のロケーションをすべて取得する。readMask は必須（例: 'name,title,metadata.placeId'） */
  listLocations(accountName: string, readMask: string): Promise<GbpLocation[]> {
    return this.listAll(
      pageToken => this.request<{ locations?: GbpLocation[]; nextPageToken?: string }>(
        GBP_HOSTS.businessInformation,
        `${accountName}/locations`,
        { query: { pageSize: 100, pageToken, readMask } },
      ),
      page => page.locations,
    )
  }

  getLocation(locationName: string, readMask: string): Promise<GbpLocation> {
    return this.request<GbpLocation>(GBP_HOSTS.businessInformation, locationName, { query: { readMask } })
  }

  /** updateMask に挙げたフィールドだけを更新する（例: ['websiteUri', 'profile.description']） */
  async updateLocation(locationName: string, patch: GbpLocationPatch, updateMask: string[]): Promise<GbpLocation> {
    if (updateMask.length === 0) throw new Error('updateMask が空です。更新するフィールドを 1 つ以上指定してください')
    return this.request<GbpLocation>(GBP_HOSTS.businessInformation, locationName, {
      method: 'PATCH',
      query: { updateMask: updateMask.join(',') },
      body: patch,
    })
  }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（12 件）

- [ ] **Step 6: Commit**

```bash
git add functions/src/shared/gbp
git commit -m "feat(gbp): ロケーションの一覧・取得・更新を追加"
```

---

### Task 3: 口コミ（v4）と変換 utility

**Files:**
- Create: `functions/src/shared/gbp/utils.ts`
- Modify: `functions/src/shared/gbp/types.ts`（口コミの型を追記）
- Modify: `functions/src/shared/gbp/GbpClient.ts`（4 メソッド追加）
- Test: `functions/src/shared/gbp/__tests__/utils.test.ts`
- Test: `functions/src/shared/gbp/__tests__/GbpClient.reviews.test.ts`

**Interfaces:**
- Consumes: Task 1 の `GbpClient` / `GBP_HOSTS` / `createTestClient`
- Produces:
  - `toV4LocationPath(accountName: string, locationName: string): string` — `('accounts/1', 'locations/2')` → `'accounts/1/locations/2'`
  - `starRatingToNumber(rating: GbpStarRating): number | null` — `'FIVE'` → `5`、`'STAR_RATING_UNSPECIFIED'` → `null`
  - 型 `GbpStarRating` / `GbpReview` / `GbpReviewReply` / `GbpListReviewsResponse` / `GbpListReviewsOptions`
  - `listReviews(locationPath: string, options?: GbpListReviewsOptions): Promise<GbpListReviewsResponse>`
  - `listAllReviews(locationPath: string): Promise<GbpReview[]>`
  - `updateReviewReply(reviewName: string, comment: string): Promise<GbpReviewReply>`
  - `deleteReviewReply(reviewName: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く（utility）**

`functions/src/shared/gbp/__tests__/utils.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { starRatingToNumber, toV4LocationPath } from '../utils'

test('toV4LocationPath: v1 のアカウント名とロケーション名を v4 のパスにする', () => {
  assert.equal(toV4LocationPath('accounts/123', 'locations/456'), 'accounts/123/locations/456')
})

test('toV4LocationPath: 形式違いのリソース名は例外', () => {
  assert.throws(() => toV4LocationPath('123', 'locations/456'), /accountName/)
  assert.throws(() => toV4LocationPath('accounts/123', '456'), /locationName/)
  assert.throws(() => toV4LocationPath('accounts/123', 'accounts/1/locations/2'), /locationName/)
  assert.throws(() => toV4LocationPath('accounts/', 'locations/456'), /accountName/)
})

test('starRatingToNumber: ONE〜FIVE を 1〜5 に、未指定は null', () => {
  assert.equal(starRatingToNumber('ONE'), 1)
  assert.equal(starRatingToNumber('THREE'), 3)
  assert.equal(starRatingToNumber('FIVE'), 5)
  assert.equal(starRatingToNumber('STAR_RATING_UNSPECIFIED'), null)
})
```

- [ ] **Step 2: 失敗するテストを書く（口コミ API）**

`functions/src/shared/gbp/__tests__/GbpClient.reviews.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestClient } from './helpers'

const V4 = 'https://mybusiness.googleapis.com/v4'
const LOCATION = 'accounts/1/locations/2'
const REVIEW = `${LOCATION}/reviews/r1`

const review = (id: string) => ({
  name: `${LOCATION}/reviews/${id}`,
  reviewId: id,
  reviewer: { displayName: '山田' },
  starRating: 'FIVE',
  createTime: '2026-10-01T00:00:00Z',
  updateTime: '2026-10-01T00:00:00Z',
})

test('listReviews: 既定 pageSize=50 で 1 ページ取得し、集計値も返す', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { reviews: [review('r1')], averageRating: 4.5, totalReviewCount: 10, nextPageToken: 'n' } },
  ])

  const page = await client.listReviews(LOCATION, { orderBy: 'updateTime desc' })

  assert.equal(page.reviews?.length, 1)
  assert.equal(page.averageRating, 4.5)
  assert.equal(page.nextPageToken, 'n')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/reviews?pageSize=50&orderBy=updateTime+desc`)
})

test('listAllReviews: 全ページを結合する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { reviews: [review('r1')], nextPageToken: 'n' } },
    { status: 200, body: { reviews: [review('r2')] } },
  ])

  const reviews = await client.listAllReviews(LOCATION)

  assert.deepEqual(reviews.map(r => r.reviewId), ['r1', 'r2'])
  assert.equal(calls[1].url, `${V4}/${LOCATION}/reviews?pageSize=50&pageToken=n`)
})

test('listAllReviews: 口コミ 0 件（reviews 省略）は空配列', async () => {
  const { client } = createTestClient([{ status: 200, body: { totalReviewCount: 0 } }])
  assert.deepEqual(await client.listAllReviews(LOCATION), [])
})

test('updateReviewReply: reply に comment を PUT する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { comment: 'ありがとうございます', updateTime: '2026-10-07T00:00:00Z' } },
  ])

  const reply = await client.updateReviewReply(REVIEW, 'ありがとうございます')

  assert.equal(reply.comment, 'ありがとうございます')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(calls[0].url, `${V4}/${REVIEW}/reply`)
  assert.deepEqual(calls[0].body, { comment: 'ありがとうございます' })
})

test('deleteReviewReply: 空ボディの 200 でも正常終了する', async () => {
  const { client, calls } = createTestClient([{ status: 200 }])

  await client.deleteReviewReply(REVIEW)

  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, `${V4}/${REVIEW}/reply`)
})

test('deleteReviewReply: 204 No Content でも正常終了する', async () => {
  const { client } = createTestClient([{ status: 204 }])
  await client.deleteReviewReply(REVIEW)
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../utils'`）

- [ ] **Step 4: 型を追記する**

`functions/src/shared/gbp/types.ts` の末尾に追加する。

```ts
export type GbpStarRating = 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'

export interface GbpReviewReply {
  /** 4096 バイト以内 */
  comment: string
  updateTime?: string
}

export interface GbpReview {
  /** accounts/{a}/locations/{l}/reviews/{reviewId} */
  name: string
  reviewId: string
  reviewer: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean }
  starRating: GbpStarRating
  /** 評価だけの口コミでは省略される */
  comment?: string
  createTime: string
  updateTime: string
  reviewReply?: GbpReviewReply
}

export interface GbpListReviewsOptions {
  /** 1〜50。既定 50 */
  pageSize?: number
  pageToken?: string
  /** 'updateTime desc'（既定） / 'rating' / 'rating desc' */
  orderBy?: string
}

export interface GbpListReviewsResponse {
  reviews?: GbpReview[]
  averageRating?: number
  totalReviewCount?: number
  nextPageToken?: string
}
```

- [ ] **Step 5: utility を実装する**

`functions/src/shared/gbp/utils.ts`:

```ts
import type { GbpStarRating } from './types'

const ACCOUNT_NAME = /^accounts\/[^/]+$/
const LOCATION_NAME = /^locations\/[^/]+$/

/**
 * v1（Business Information）のロケーション名を、v4（口コミ・投稿）のパスに変換する。
 * 例: ('accounts/1', 'locations/2') → 'accounts/1/locations/2'
 */
export function toV4LocationPath(accountName: string, locationName: string): string {
  if (!ACCOUNT_NAME.test(accountName)) throw new Error(`accountName の形式が不正です: ${accountName}`)
  if (!LOCATION_NAME.test(locationName)) throw new Error(`locationName の形式が不正です: ${locationName}`)
  return `${accountName}/${locationName}`
}

const STAR_RATINGS: Record<GbpStarRating, number | null> = {
  STAR_RATING_UNSPECIFIED: null,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

export function starRatingToNumber(rating: GbpStarRating): number | null {
  return STAR_RATINGS[rating] ?? null
}
```

- [ ] **Step 6: メソッドを実装する**

`functions/src/shared/gbp/GbpClient.ts` の import を差し替える。

```ts
import type {
  AccessTokenProvider,
  GbpAccount,
  GbpClientOptions,
  GbpListReviewsOptions,
  GbpListReviewsResponse,
  GbpLocation,
  GbpLocationPatch,
  GbpReview,
  GbpReviewReply,
} from './types'
```

`updateLocation()` の直後に追加する。

```ts
  /** 口コミを 1 ページ取得する。locationPath は toV4LocationPath で作った 'accounts/{a}/locations/{l}' */
  listReviews(locationPath: string, options: GbpListReviewsOptions = {}): Promise<GbpListReviewsResponse> {
    return this.request<GbpListReviewsResponse>(GBP_HOSTS.v4, `${locationPath}/reviews`, {
      query: { pageSize: options.pageSize ?? 50, pageToken: options.pageToken, orderBy: options.orderBy },
    })
  }

  listAllReviews(locationPath: string): Promise<GbpReview[]> {
    return this.listAll(
      pageToken => this.listReviews(locationPath, { pageToken }),
      page => page.reviews,
    )
  }

  /** 返信を作成または上書きする（PUT のため再実行しても結果は同じ） */
  updateReviewReply(reviewName: string, comment: string): Promise<GbpReviewReply> {
    return this.request<GbpReviewReply>(GBP_HOSTS.v4, `${reviewName}/reply`, { method: 'PUT', body: { comment } })
  }

  async deleteReviewReply(reviewName: string): Promise<void> {
    await this.request<unknown>(GBP_HOSTS.v4, `${reviewName}/reply`, { method: 'DELETE' })
  }
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（21 件）

- [ ] **Step 8: Commit**

```bash
git add functions/src/shared/gbp
git commit -m "feat(gbp): 口コミの取得・返信・返信削除と v4 パス変換を追加"
```

---

### Task 4: 投稿（v4 localPosts）

**Files:**
- Modify: `functions/src/shared/gbp/types.ts`（投稿の型を追記）
- Modify: `functions/src/shared/gbp/GbpClient.ts`（3 メソッド追加）
- Test: `functions/src/shared/gbp/__tests__/GbpClient.localPosts.test.ts`

**Interfaces:**
- Consumes: Task 1 の `GbpClient` / `GBP_HOSTS` / `createTestClient`、Task 2 の `GbpDate` / `GbpTimeOfDay`
- Produces:
  - 型 `GbpLocalPostTopicType` / `GbpCallToActionType` / `GbpTimeInterval` / `GbpLocalPostInput` / `GbpLocalPost` / `GbpLocalPostState`
  - `listLocalPosts(locationPath: string): Promise<GbpLocalPost[]>`
  - `createLocalPost(locationPath: string, post: GbpLocalPostInput): Promise<GbpLocalPost>`
  - `deleteLocalPost(postName: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/shared/gbp/__tests__/GbpClient.localPosts.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GbpLocalPostInput } from '../types'
import { createTestClient } from './helpers'

const V4 = 'https://mybusiness.googleapis.com/v4'
const LOCATION = 'accounts/1/locations/2'

test('listLocalPosts: pageSize=100 で全ページ取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { localPosts: [{ name: `${LOCATION}/localPosts/p1`, summary: 'a', topicType: 'STANDARD', languageCode: 'ja' }], nextPageToken: 'n' } },
    { status: 200, body: {} },
  ])

  const posts = await client.listLocalPosts(LOCATION)

  assert.deepEqual(posts.map(p => p.name), [`${LOCATION}/localPosts/p1`])
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts?pageSize=100`)
  assert.equal(calls[1].url, `${V4}/${LOCATION}/localPosts?pageSize=100&pageToken=n`)
})

test('createLocalPost: イベント投稿をそのままの形で POST する', async () => {
  const post: GbpLocalPostInput = {
    languageCode: 'ja',
    summary: '秋のフェア開催',
    topicType: 'EVENT',
    callToAction: { actionType: 'LEARN_MORE', url: 'https://example.com/fair' },
    media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://example.com/a.jpg' }],
    event: {
      title: '秋のフェア',
      schedule: {
        startDate: { year: 2026, month: 10, day: 10 },
        startTime: { hours: 10, minutes: 0 },
        endDate: { year: 2026, month: 10, day: 20 },
        endTime: { hours: 18, minutes: 0 },
      },
    },
  }
  const { client, calls } = createTestClient([
    { status: 200, body: { ...post, name: `${LOCATION}/localPosts/p9`, state: 'PROCESSING', searchUrl: 'https://g.co/x' } },
  ])

  const created = await client.createLocalPost(LOCATION, post)

  assert.equal(created.name, `${LOCATION}/localPosts/p9`)
  assert.equal(created.state, 'PROCESSING')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts`)
  assert.deepEqual(calls[0].body, post)
})

test('createLocalPost: 5xx でも再試行しない（POST は冪等でないため二重投稿を防ぐ）', async () => {
  const { client, calls } = createTestClient([{ status: 503, body: '' }])
  await assert.rejects(
    client.createLocalPost(LOCATION, { languageCode: 'ja', summary: 'a', topicType: 'STANDARD' }),
    { name: 'GbpApiError', status: 503 },
  )
  assert.equal(calls.length, 1)
})

test('createLocalPost: 429 は再試行する（Google が処理していないことが確実なため）', async () => {
  const { client, calls } = createTestClient([
    { status: 429, body: '' },
    { status: 200, body: { name: `${LOCATION}/localPosts/p1`, languageCode: 'ja', summary: 'a', topicType: 'STANDARD' } },
  ])
  await client.createLocalPost(LOCATION, { languageCode: 'ja', summary: 'a', topicType: 'STANDARD' })
  assert.equal(calls.length, 2)
})

test('deleteLocalPost: 投稿名に DELETE する', async () => {
  const { client, calls } = createTestClient([{ status: 200, body: {} }])

  await client.deleteLocalPost(`${LOCATION}/localPosts/p1`)

  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts/p1`)
})
```

> 2・3 件目のテストは設計書 4.5「投稿は冪等でない」から導いた挙動。POST を 5xx で自動再試行すると、Google 側で作成済みだった場合に二重投稿になる。429 はリクエストが処理されていないので再試行してよい。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Property 'listLocalPosts' does not exist on type 'GbpClient'`）

- [ ] **Step 3: 型を追記する**

`functions/src/shared/gbp/types.ts` の末尾に追加する。

```ts
export type GbpLocalPostTopicType = 'STANDARD' | 'EVENT' | 'OFFER'

export type GbpCallToActionType = 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL'

export type GbpLocalPostState = 'LOCAL_POST_STATE_UNSPECIFIED' | 'REJECTED' | 'LIVE' | 'PROCESSING' | 'SCHEDULED' | 'RECURRING'

export interface GbpTimeInterval {
  startDate: GbpDate
  startTime?: GbpTimeOfDay
  endDate: GbpDate
  endTime?: GbpTimeOfDay
}

export interface GbpLocalPostInput {
  languageCode: string
  summary: string
  topicType: GbpLocalPostTopicType
  /** CALL のときは url 不要 */
  callToAction?: { actionType: GbpCallToActionType; url?: string }
  /** 投稿で使えるのは sourceUrl（Google が取得できる公開 URL）のみ */
  media?: { mediaFormat: 'PHOTO'; sourceUrl: string }[]
  /** EVENT / OFFER で必須 */
  event?: { title: string; schedule: GbpTimeInterval }
  offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string }
}

export interface GbpLocalPost extends Omit<GbpLocalPostInput, 'topicType'> {
  /** accounts/{a}/locations/{l}/localPosts/{postId} */
  name: string
  /** API は ALERT も返しうるため入力型より広い */
  topicType: GbpLocalPostTopicType | 'ALERT' | 'LOCAL_POST_TOPIC_TYPE_UNSPECIFIED'
  state?: GbpLocalPostState
  searchUrl?: string
  createTime?: string
  updateTime?: string
}
```

- [ ] **Step 4: 再試行対象を呼び出しごとに絞れるようにする**

`functions/src/shared/gbp/GbpClient.ts` の `RequestOptions` に `retryStatuses` を追加する。

```ts
interface RequestOptions {
  method?: HttpMethod
  query?: Query
  body?: unknown
  /** 再試行する HTTP ステータス。既定は 429 / 5xx。冪等でない POST は 429 のみにする */
  retryStatuses?: ReadonlySet<number>
}
```

`RETRYABLE_STATUSES` の下に定数を追加する。

```ts
const NON_IDEMPOTENT_RETRYABLE_STATUSES = new Set([429])
```

`request()` 内の再試行判定を差し替える。

```ts
      const retryStatuses = options.retryStatuses ?? RETRYABLE_STATUSES
      if (retryStatuses.has(response.status) && attempt < this.retry.maxRetries) {
```

- [ ] **Step 5: メソッドを実装する**

`functions/src/shared/gbp/GbpClient.ts` の import に `GbpLocalPost` と `GbpLocalPostInput` を追加する。

```ts
import type {
  AccessTokenProvider,
  GbpAccount,
  GbpClientOptions,
  GbpListReviewsOptions,
  GbpListReviewsResponse,
  GbpLocalPost,
  GbpLocalPostInput,
  GbpLocation,
  GbpLocationPatch,
  GbpReview,
  GbpReviewReply,
} from './types'
```

`deleteReviewReply()` の直後に追加する。

```ts
  listLocalPosts(locationPath: string): Promise<GbpLocalPost[]> {
    return this.listAll(
      pageToken => this.request<{ localPosts?: GbpLocalPost[]; nextPageToken?: string }>(
        GBP_HOSTS.v4,
        `${locationPath}/localPosts`,
        { query: { pageSize: 100, pageToken } },
      ),
      page => page.localPosts,
    )
  }

  /** 投稿を作成する。冪等でないため 5xx では再試行しない（重複防止は呼び出し側の責務） */
  createLocalPost(locationPath: string, post: GbpLocalPostInput): Promise<GbpLocalPost> {
    return this.request<GbpLocalPost>(GBP_HOSTS.v4, `${locationPath}/localPosts`, {
      method: 'POST',
      body: post,
      retryStatuses: NON_IDEMPOTENT_RETRYABLE_STATUSES,
    })
  }

  async deleteLocalPost(postName: string): Promise<void> {
    await this.request<unknown>(GBP_HOSTS.v4, postName, { method: 'DELETE' })
  }
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（26 件）

- [ ] **Step 7: Commit**

```bash
git add functions/src/shared/gbp
git commit -m "feat(gbp): 投稿の一覧・作成・削除を追加（作成は 5xx で再試行しない）"
```

---

### Task 5: トークンプロバイダーと公開 export

**Files:**
- Modify: `functions/package.json`（`google-auth-library` を dependencies に追加）
- Create: `functions/src/shared/gbp/createTokenProvider.ts`
- Create: `functions/src/shared/gbp/index.ts`
- Test: `functions/src/shared/gbp/__tests__/createTokenProvider.test.ts`

**Interfaces:**
- Consumes: Task 1 の `GbpAuthError` / `AccessTokenProvider`、Task 1〜4 のすべての export
- Produces:
  - `createTokenProvider(options: { clientId: string; clientSecret: string; refreshToken: string }): AccessTokenProvider`
  - `toGbpAuthError(error: unknown): unknown` — OAuth の失効系エラーなら `GbpAuthError`、それ以外は受け取った値をそのまま返す
  - `functions/src/shared/gbp/index.ts` から: `GbpClient` / `GBP_HOSTS` / `GbpApiError` / `GbpAuthError` / `createTokenProvider` / `toGbpAuthError` / `toV4LocationPath` / `starRatingToNumber` / `types.ts` の全型

- [ ] **Step 1: 依存を追加する**

Run: `cd functions && npm install google-auth-library@^10`
Expected: `package.json` の `dependencies` に `google-auth-library` が入る（`firebase-admin` が既に依存しているため重複インストールにはならない）

インストール後、`npm ls google-auth-library` で解決されたバージョンを確認する。`OAuth2Client` のコンストラクタが `{ clientId, clientSecret }` のオブジェクト引数を受けること、`getAccessToken()` が `{ token }` を返すことを、そのバージョンの `node_modules/google-auth-library/build/src/auth/oauth2client.d.ts` で確認する。

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/shared/gbp/__tests__/createTokenProvider.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GbpAuthError } from '../errors'
import { toGbpAuthError } from '../createTokenProvider'

/** google-auth-library（gaxios）がトークン更新失敗時に投げるエラーの形 */
function gaxiosError(code: string) {
  return Object.assign(new Error(code), { response: { status: 400, data: { error: code, error_description: 'desc' } } })
}

for (const code of ['invalid_grant', 'invalid_client', 'unauthorized_client']) {
  test(`toGbpAuthError: ${code} は GbpAuthError にする`, () => {
    const converted = toGbpAuthError(gaxiosError(code))
    assert.ok(converted instanceof GbpAuthError)
    assert.equal(converted.reason, code)
  })
}

test('toGbpAuthError: それ以外の OAuth エラーやネットワークエラーはそのまま返す', () => {
  const tempError = gaxiosError('temporarily_unavailable')
  assert.equal(toGbpAuthError(tempError), tempError)
  const network = new TypeError('fetch failed')
  assert.equal(toGbpAuthError(network), network)
})

test('toGbpAuthError: 既に GbpAuthError ならそのまま返す', () => {
  const error = new GbpAuthError('invalid_grant', 'x')
  assert.equal(toGbpAuthError(error), error)
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../createTokenProvider'`）

- [ ] **Step 4: 実装する**

`functions/src/shared/gbp/createTokenProvider.ts`:

```ts
import { OAuth2Client } from 'google-auth-library'
import { GbpAuthError } from './errors'
import type { AccessTokenProvider } from './types'

/** 再認証しないと解消しない OAuth エラー */
const AUTH_ERROR_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client'])

export interface TokenProviderOptions {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** OAuth の失効系エラーを GbpAuthError に変換する。該当しなければ受け取った値を返す */
export function toGbpAuthError(error: unknown): unknown {
  if (error instanceof GbpAuthError) return error
  const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error
  if (typeof code === 'string' && AUTH_ERROR_CODES.has(code)) {
    return new GbpAuthError(code, `Google の認証が無効です（${code}）。再認証してください`)
  }
  return error
}

/**
 * refresh token からアクセストークンを返す関数を作る。
 * 有効期限内のトークンは google-auth-library がキャッシュし、期限が近づいたら自動で更新する。
 */
export function createTokenProvider(options: TokenProviderOptions): AccessTokenProvider {
  const client = new OAuth2Client({ clientId: options.clientId, clientSecret: options.clientSecret })
  client.setCredentials({ refresh_token: options.refreshToken })
  return async () => {
    try {
      const { token } = await client.getAccessToken()
      if (!token) throw new GbpAuthError('no_token', 'アクセストークンを取得できませんでした。再認証してください')
      return token
    }
    catch (error) {
      throw toGbpAuthError(error)
    }
  }
}
```

`functions/src/shared/gbp/index.ts`:

```ts
// Google Business Profile API クライアント。
// このフォルダは Firebase / プロジェクト固有コードに依存しない。フォルダごとコピーすれば他プロジェクトで使える。
export { GbpClient, GBP_HOSTS } from './GbpClient'
export { GbpApiError, GbpAuthError } from './errors'
export { createTokenProvider, toGbpAuthError } from './createTokenProvider'
export type { TokenProviderOptions } from './createTokenProvider'
export { starRatingToNumber, toV4LocationPath } from './utils'
export type * from './types'
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd functions && npm test`
Expected: PASS（31 件）

- [ ] **Step 6: 依存方向と本番ビルドを確認する**

Run: `cd functions && grep -rnE "from '(firebase|\.\./\.\.)" src/shared/gbp --include=*.ts | grep -v __tests__; npm run build`
Expected: grep の出力なし（Firebase・上位フォルダへの import がない）、ビルド成功

- [ ] **Step 7: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/shared/gbp
git commit -m "feat(gbp): refresh token のトークンプロバイダーと公開 export を追加"
```

---

## 完了条件

- `cd functions && npm test` で 31 件すべて PASS
- `cd functions && npm run build` が成功し、`lib/` に `__tests__` が出力されない
- `functions/src/shared/gbp/` が `google-auth-library` 以外の外部モジュール・上位フォルダを import していない
