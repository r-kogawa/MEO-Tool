import { GbpAuthError, GbpClient } from '../shared/gbp'
import type { GbpAccount, GbpLocalPost, GbpLocalPostInput, GbpLocation, GbpReview } from '../shared/gbp'
import type { ExchangedTokens, GoogleDeps } from '../google/deps'

/** ロケーション取得・更新、口コミ一覧・返信を受け付ける偽の GBP */
export interface FakeGbpServer {
  /** キーは locations/{id} */
  locations: Record<string, GbpLocation>
  /** キーは accounts/{a}/locations/{l} */
  reviews: Record<string, GbpReview[]>
  /** この文字列を URL に含むリクエストは 403 にする */
  failingNames: string[]
  patches: { name: string; updateMask: string; body: unknown }[]
  replies: { name: string; comment: string }[]
  deletedReplies: string[]
  /** キーは accounts/{a}/locations/{l} */
  posts: Record<string, GbpLocalPost[]>
  createdPosts: { location: string; body: GbpLocalPostInput }[]
  deletedPosts: string[]
}

export function createFakeGbpServer(): FakeGbpServer {
  return { locations: {}, reviews: {}, failingNames: [], patches: [], replies: [], deletedReplies: [], posts: {}, createdPosts: [], deletedPosts: [] }
}

interface FakeGoogleOptions {
  tokens?: ExchangedTokens
  accounts?: GbpAccount[]
  /** refresh token ごとのロケーション一覧。数値は HTTP エラーのステータス。キーが無い refresh token は GbpAuthError にする */
  locationsByRefreshToken?: Record<string, Record<string, GbpLocation[] | number>>
  exchangeError?: Error
  gbp?: FakeGbpServer
  /** gbp を使うときに失効扱いにする refresh token */
  expiredRefreshTokens?: string[]
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const forbidden = () => json({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, 403)

function handleGbp(server: FakeGbpServer, url: URL, method: string, body: unknown): Response {
  if (server.failingNames.some(name => url.pathname.includes(name))) return forbidden()
  const location = url.pathname.match(/^\/v1\/(locations\/[^/]+)$/)?.[1]
  if (location) {
    const current = server.locations[location]
    if (!current) return json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404)
    if (method === 'PATCH') {
      server.patches.push({ name: location, updateMask: url.searchParams.get('updateMask') ?? '', body })
      server.locations[location] = { ...current, ...(body as object) }
    }
    return json(server.locations[location])
  }
  const reviewsOf = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+)\/reviews$/)?.[1]
  if (reviewsOf) return json({ reviews: server.reviews[reviewsOf] ?? [] })
  const reply = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+)\/reply$/)?.[1]
  if (reply && method === 'PUT') {
    const comment = (body as { comment: string }).comment
    server.replies.push({ name: reply, comment })
    return json({ comment, updateTime: '2026-10-07T00:00:00Z' })
  }
  if (reply && method === 'DELETE') {
    server.deletedReplies.push(reply)
    return new Response(null, { status: 200 })
  }
  const postsOf = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+)\/localPosts$/)?.[1]
  if (postsOf && method === 'GET') return json({ localPosts: server.posts[postsOf] ?? [] })
  if (postsOf && method === 'POST') {
    server.createdPosts.push({ location: postsOf, body: body as GbpLocalPostInput })
    const id = `p${server.createdPosts.length}`
    const created: GbpLocalPost = {
      ...(body as GbpLocalPostInput),
      name: `${postsOf}/localPosts/${id}`,
      state: 'LIVE',
      searchUrl: `https://local.google.com/post/${id}`,
      createTime: '2026-10-07T00:00:00Z',
    }
    ;(server.posts[postsOf] ??= []).push(created)
    return json(created)
  }
  const postName = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+)\/localPosts\/[^/]+$/)?.[0]?.slice('/v4/'.length)
  if (postName && method === 'DELETE') {
    const location = postName.replace(/\/localPosts\/[^/]+$/, '')
    const list = server.posts[location] ?? []
    if (!list.some(post => post.name === postName)) return json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404)
    server.posts[location] = list.filter(post => post.name !== postName)
    server.deletedPosts.push(postName)
    return new Response(null, { status: 200 })
  }
  throw new Error(`偽 GBP が扱わないリクエスト: ${method} ${url}`)
}

/** 外部（Google）を呼ばない偽の GoogleDeps。GbpClient は偽 fetch で応答を返す */
export function createFakeGoogle(options: FakeGoogleOptions = {}) {
  const calls = { exchange: 0, revoked: [] as string[], exchangeInputs: [] as unknown[] }
  const deps: GoogleDeps = {
    async exchangeCode(input) {
      calls.exchange++
      calls.exchangeInputs.push(input)
      if (options.exchangeError) throw options.exchangeError
      return options.tokens ?? { refreshToken: 'refresh-1', accessToken: 'access-1', googleEmail: 'Shop@Example.com' }
    },
    async listAccounts() {
      return options.accounts ?? [{ name: 'accounts/100', accountName: 'ハナミ食堂' }]
    },
    async revokeToken(token) {
      calls.revoked.push(token)
    },
    createGbpClient({ refreshToken }) {
      const byAccount = options.locationsByRefreshToken?.[refreshToken]
      const isExpired = options.gbp
        ? (options.expiredRefreshTokens ?? []).includes(refreshToken)
        : !byAccount
      return new GbpClient({
        getAccessToken: async () => {
          if (isExpired) throw new GbpAuthError('invalid_grant', 'Google の認証が無効です（invalid_grant）。再認証してください')
          return 'access'
        },
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input))
          const method = init?.method ?? 'GET'
          const listedAccount = url.pathname.match(/^\/v1\/(accounts\/[^/]+)\/locations$/)?.[1]
          if (listedAccount && byAccount) {
            const result = byAccount[listedAccount] ?? []
            return typeof result === 'number' ? (result === 403 ? forbidden() : json({}, result)) : json({ locations: result })
          }
          if (!options.gbp) return json({ locations: [] })
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
          return handleGbp(options.gbp, url, method, body)
        }) as typeof fetch,
        sleep: async () => {},
      })
    },
  }
  return { deps, calls }
}
