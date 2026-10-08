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
