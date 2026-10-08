import { OAuth2Client } from 'google-auth-library'
import { createTokenProvider, GbpClient, type GbpAccount } from '../shared/gbp'

// Google（OAuth・GBP API）への外部呼び出し。テストでは偽物に差し替える。

export interface ExchangedTokens {
  /** 以前に同意済みなどで返らないことがある */
  refreshToken: string | null
  accessToken: string
  googleEmail: string
}

export interface GoogleDeps {
  exchangeCode(input: { clientId: string; clientSecret: string; redirectUri: string; code: string }): Promise<ExchangedTokens>
  listAccounts(accessToken: string): Promise<GbpAccount[]>
  revokeToken(token: string): Promise<void>
  createGbpClient(input: { clientId: string; clientSecret: string; refreshToken: string }): GbpClient
}

export const defaultGoogleDeps: GoogleDeps = {
  async exchangeCode({ clientId, clientSecret, redirectUri, code }) {
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
    const { tokens } = await client.getToken(code)
    if (!tokens.access_token) throw new Error('access token が返りませんでした')
    const info = await client.getTokenInfo(tokens.access_token)
    return { refreshToken: tokens.refresh_token ?? null, accessToken: tokens.access_token, googleEmail: info.email ?? '' }
  },
  listAccounts(accessToken) {
    return new GbpClient({ getAccessToken: async () => accessToken }).listAccounts()
  },
  async revokeToken(token) {
    await new OAuth2Client().revokeToken(token)
  },
  createGbpClient({ clientId, clientSecret, refreshToken }) {
    return new GbpClient({ getAccessToken: createTokenProvider({ clientId, clientSecret, refreshToken }) })
  },
}
