/** GBP API が 2xx 以外を返した（再試行しても解消しなかった）ときのエラー */
export class GbpApiError extends Error {
  readonly status: number
  /** Google のエラー理由（ErrorInfo.reason または error.status）。通信エラーは NETWORK_ERROR / TIMEOUT。取れなければ null */
  readonly reason: string | null
  /** 通信エラー時の元の例外 */
  readonly cause?: unknown

  /** status 0 は応答を受け取れなかった（通信エラー・タイムアウト）ことを表す */
  constructor(status: number, reason: string | null, message: string, cause?: unknown) {
    super(message)
    this.name = 'GbpApiError'
    this.status = status
    this.reason = reason
    this.cause = cause
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
