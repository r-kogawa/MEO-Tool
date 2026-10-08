import { GbpApiError } from './errors'
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

export const GBP_HOSTS = {
  accountManagement: 'https://mybusinessaccountmanagement.googleapis.com/v1',
  businessInformation: 'https://mybusinessbusinessinformation.googleapis.com/v1',
  v4: 'https://mybusiness.googleapis.com/v4',
} as const

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const NON_IDEMPOTENT_RETRYABLE_STATUSES = new Set([429])
const DEFAULT_RETRY = { maxRetries: 3, baseDelayMs: 500 }
const DEFAULT_TIMEOUT_MS = 30_000

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | undefined>

interface RequestOptions {
  method?: HttpMethod
  query?: Query
  body?: unknown
  /**
   * 冪等でない（再送すると重複しうる）リクエストは false にする。既定 true。
   * false のときは 429 だけを再試行し、5xx・通信エラーは再試行しない
   */
  isIdempotent?: boolean
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

/** fetch が投げた例外（通信エラー・タイムアウト）を status 0 の GbpApiError に包む */
function toNetworkError(cause: unknown): GbpApiError {
  const isTimeout = (cause as { name?: unknown } | null)?.name === 'TimeoutError'
  const detail = cause instanceof Error ? cause.message : String(cause)
  return isTimeout
    ? new GbpApiError(0, 'TIMEOUT', `GBP API の応答がタイムアウトしました: ${detail}`, cause)
    : new GbpApiError(0, 'NETWORK_ERROR', `GBP API に接続できませんでした: ${detail}`, cause)
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
  private readonly timeoutMs: number

  constructor(options: GbpClientOptions) {
    this.getAccessToken = options.getAccessToken
    this.fetchImpl = options.fetch ?? fetch
    this.retry = options.retry ?? DEFAULT_RETRY
    this.sleep = options.sleep ?? defaultSleep
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
      isIdempotent: false,
    })
  }

  async deleteLocalPost(postName: string): Promise<void> {
    await this.request<unknown>(GBP_HOSTS.v4, postName, { method: 'DELETE' })
  }

  /**
   * 1 リクエストを送る。試行ごとにトークンを取り直す。
   * 冪等なリクエストは 429 / 5xx / 通信エラーを、冪等でないリクエストは 429 だけを指数バックオフで再試行する
   */
  private async request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(baseUrl, path, options.query)
    const method = options.method ?? 'GET'
    const hasBody = options.body !== undefined
    const isIdempotent = options.isIdempotent ?? true
    const retryStatuses = isIdempotent ? RETRYABLE_STATUSES : NON_IDEMPOTENT_RETRYABLE_STATUSES
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.retry.maxRetries
      const token = await this.getAccessToken()
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          },
          body: hasBody ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      }
      catch (cause) {
        if (isIdempotent && canRetry) {
          await this.sleep(this.retry.baseDelayMs * 2 ** attempt)
          continue
        }
        throw toNetworkError(cause)
      }
      if (response.ok) {
        const text = await response.text()
        return (text ? JSON.parse(text) : undefined) as T
      }
      // 前回の試行で削除が済んだあとにエラー応答だけが返ったケース。結果としては削除済み
      if (method === 'DELETE' && response.status === 404 && attempt > 0) return undefined as T
      if (retryStatuses.has(response.status) && canRetry) {
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
