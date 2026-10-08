import { GbpClient } from '../GbpClient'

export interface FakeResponse {
  status: number
  /** オブジェクトは JSON にする。文字列はそのまま本文にする。undefined は本文なし */
  body?: unknown
  /** 指定すると応答を返さずにこの例外を投げる（通信エラー・タイムアウトの再現） */
  throws?: Error
}

export interface FakeCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  signal: AbortSignal | null | undefined
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
      signal: init?.signal,
    })
    const next = queue.shift()
    if (!next) throw new Error(`想定外のリクエスト: ${String(input)}`)
    if (next.throws) throw next.throws
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
