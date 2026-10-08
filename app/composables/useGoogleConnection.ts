import { callFunction } from '~/utils/firebase/callFunction'
import {
  createGoogleConnectionFunc,
  deleteGoogleConnectionFunc,
  deleteGoogleOAuthClientFunc,
  updateGoogleConnectionReauthFunc,
  updateGoogleOAuthClientFunc,
} from '~/utils/mock/functions/google'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-04 Google Business Profile 連携。
// 本物モードは組織の OAuth クライアントで Google の同意画面へ移動し、コールバック後に設定画面へ戻る。
// モックでは入力したアカウントで即時に連携する。

/** googleOAuthCallback が付けて戻すエラーコード */
export const GOOGLE_CALLBACK_ERRORS: Record<string, string> = {
  access_denied: 'Google の同意画面でアクセスが許可されませんでした。',
  invalid_client: 'OAuth クライアントの設定が正しくありません。クライアント ID・シークレットと、承認済みのリダイレクト URI を確認してください。',
  exchange_failed: 'Google との認証に失敗しました。時間をおいて再度お試しください。',
  no_refresh_token: 'Google から長期利用の許可（refresh token）を受け取れませんでした。Google アカウントの「サードパーティによるアクセス」から一度アクセス権を削除して、もう一度連携してください。',
  gbp_accounts_failed: 'ビジネスプロフィールのアカウントを取得できませんでした。GBP API の利用承認と、連携したアカウントがビジネスプロフィールの管理者になっているかを確認してください。',
  invalid_state: '連携の有効期限が切れました。もう一度「Google で連携する」からやり直してください。',
  save_failed: 'Google 連携の保存に失敗しました。時間をおいて再度お試しください。解決しない場合は運営にお問い合わせください。',
}

export function useGoogleConnection() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, org } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const connections = computed(() => db.value.googleConnections.filter(item => item.orgId === orgId.value))
  const activeConnections = computed(() => connections.value.filter(item => item.status === 'active'))
  const hasError = computed(() => connections.value.some(item => item.status === 'error'))
  const isConnected = computed(() => activeConnections.value.length > 0)
  const oauthClient = computed(() => org.value?.googleOAuthClient ?? null)
  const callbackUrl = ref<string | null>(null)

  async function loadCallbackUrl(): Promise<void> {
    if (isMock) {
      callbackUrl.value = 'https://asia-northeast1-<プロジェクト ID>.cloudfunctions.net/googleOAuthCallback'
      return
    }
    const result = await callFunction<object, { callbackUrl: string }>($functions, 'getGoogleOAuthConfig', { orgId: orgId.value })
    callbackUrl.value = result.callbackUrl
  }

  async function registerOAuthClient(clientId: string, clientSecret: string): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateGoogleOAuthClient', { orgId: orgId.value, clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      return
    }
    await mockLatency()
    updateGoogleOAuthClientFunc(db.value, user.value!.uid, orgId.value, clientId)
  }

  async function removeOAuthClient(): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'deleteGoogleOAuthClient', { orgId: orgId.value })
      return
    }
    await mockLatency()
    deleteGoogleOAuthClientFunc(db.value, user.value!.uid, orgId.value)
  }

  /** Google の同意画面へ移動する（戻り先は Functions のコールバックが決める） */
  async function startGoogleAuth(): Promise<void> {
    const { url } = await callFunction<object, { url: string }>($functions, 'createGoogleAuthUrl', { orgId: orgId.value })
    window.location.assign(url)
  }

  async function connect(googleEmail: string) {
    await mockLatency(800)
    return createGoogleConnectionFunc(db.value, user.value!.uid, orgId.value, googleEmail.trim())
  }

  async function reauthorize(connectionId: string) {
    if (!isMock) return startGoogleAuth()
    await mockLatency(800)
    updateGoogleConnectionReauthFunc(db.value, user.value!.uid, orgId.value, connectionId)
  }

  async function disconnect(connectionId: string) {
    if (!isMock) {
      await callFunction($functions, 'deleteGoogleConnection', { orgId: orgId.value, connectionId })
      return
    }
    await mockLatency()
    deleteGoogleConnectionFunc(db.value, user.value!.uid, orgId.value, connectionId)
  }

  return {
    connections,
    activeConnections,
    hasError,
    isConnected,
    oauthClient,
    callbackUrl,
    loadCallbackUrl,
    registerOAuthClient,
    removeOAuthClient,
    startGoogleAuth,
    connect,
    reauthorize,
    disconnect,
  }
}
