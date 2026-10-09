<script setup lang="ts">
import type { ConnectionStatus, GoogleConnection } from '~/types/domain'
import type { BadgeTone } from '~/components/Ui/Common/Badge.vue'

// F-04 Google Business Profile 連携（owner / admin）

definePageMeta({ layout: 'admin', roles: ['owner', 'admin'] })
useHead({ title: 'Google 連携' })

const { adminPath, isOwner } = useCurrentOrg()
const { isMock } = useDemoSession()
const route = useRoute()
const router = useRouter()
const {
  connections,
  oauthClient,
  callbackUrl,
  loadCallbackUrl,
  removeOAuthClient,
  startGoogleAuth,
  connect,
  reauthorize,
  disconnect,
} = useGoogleConnection()
const { show } = useToast()

const STATUS: Record<ConnectionStatus, { label: string; tone: BadgeTone }> = {
  active: { label: '連携中', tone: 'success' },
  error: { label: '要再認証', tone: 'danger' },
  revoked: { label: '解除済み', tone: 'neutral' },
}

const googleEmail = ref('')
const emailError = ref<string | null>(null)
const connectState = useActionState()
const rowState = useActionState()
const busyId = ref<string | null>(null)
const disconnectTarget = ref<GoogleConnection | null>(null)
const isDisconnectOpen = computed({
  get: () => disconnectTarget.value !== null,
  set: (value: boolean) => { if (!value) disconnectTarget.value = null },
})

const sortedConnections = computed(() =>
  [...connections.value].sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked')))

const authState = useActionState()
const removeClientState = useActionState()
const isClientFormOpen = ref(false)

/** コールバックから戻ったときの結果（?connected=1 / ?error=...）を一度だけ表示する */
const callbackError = ref<string | null>(null)
onMounted(async () => {
  void loadCallbackUrl().catch(() => { callbackUrl.value = null })
  const { connected, error, ...rest } = route.query
  if (connected === '1') show('Google と連携しました')
  if (typeof error === 'string') callbackError.value = GOOGLE_CALLBACK_ERRORS[error] ?? GOOGLE_CALLBACK_ERRORS.exchange_failed!
  if (connected || error) await router.replace({ query: rest })
})

async function onStartGoogleAuth(): Promise<void> {
  await authState.run(startGoogleAuth)
}

async function onRemoveClient(): Promise<void> {
  await removeClientState.run(removeOAuthClient)
  if (!removeClientState.errorMessage.value) show('OAuth クライアントを削除しました')
}

function onClientSaved(): void {
  isClientFormOpen.value = false
  show('OAuth クライアントを登録しました')
}

async function onConnect(): Promise<void> {
  emailError.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail.value.trim()) ? null : 'Google アカウントのメールアドレスを入力してください'
  if (emailError.value) return
  const created = await connectState.run(() => connect(googleEmail.value))
  if (!created) return
  googleEmail.value = ''
  show('Google と連携しました')
}

async function onReauthorize(connection: GoogleConnection): Promise<void> {
  busyId.value = connection.id
  await rowState.run(() => reauthorize(connection.id))
  busyId.value = null
  if (rowState.errorMessage.value) show(rowState.errorMessage.value, 'danger')
  else show('再認証しました')
}

async function onDisconnect(): Promise<void> {
  const target = disconnectTarget.value
  if (!target) return
  await rowState.run(() => disconnect(target.id))
  if (rowState.errorMessage.value) return
  disconnectTarget.value = null
  show('連携を解除しました')
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UiCommonPageHeader title="Google 連携" description="Google ビジネスプロフィール（GBP）と連携し、店舗情報を取り込みます" />

    <UiCommonCard title="OAuth クライアント">
      <div class="space-y-4">
        <SettingsGoogleSetupGuide :callback-url="callbackUrl" />
        <div v-if="oauthClient" class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div>
            <p class="font-medium break-all text-slate-900">{{ oauthClient.clientId }}</p>
            <p class="text-xs text-slate-500">登録日 {{ formatDate(oauthClient.configuredAt) }}</p>
          </div>
          <div v-if="isOwner" class="flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="isClientFormOpen = !isClientFormOpen">変更</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" :is-loading="removeClientState.isPending.value" @click="onRemoveClient">削除</UiCommonButton>
          </div>
        </div>
        <UiCommonAlert v-if="removeClientState.errorMessage.value" tone="danger">{{ removeClientState.errorMessage.value }}</UiCommonAlert>
        <SettingsGoogleOAuthClientForm
          v-if="isOwner && (!oauthClient || isClientFormOpen)"
          :current-client-id="oauthClient?.clientId ?? null"
          @saved="onClientSaved"
        />
        <p v-else-if="!oauthClient" class="text-sm text-slate-500">OAuth クライアントの登録はオーナーが行います。</p>
      </div>
    </UiCommonCard>

    <UiCommonAlert v-if="callbackError" tone="danger">{{ callbackError }}</UiCommonAlert>

    <UiCommonCard title="連携中のアカウント" is-flush>
      <p v-if="sortedConnections.length === 0" class="p-5 text-sm text-slate-500">まだ連携していません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="connection in sortedConnections" :key="connection.id" class="flex flex-wrap items-start gap-3 px-5 py-4">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <UiCommonIcon name="google" size-class="size-4.5" />
          </span>
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium break-all" :class="connection.status === 'revoked' ? 'text-slate-500' : 'text-slate-900'">{{ connection.googleEmail }}</p>
              <UiCommonBadge :tone="STATUS[connection.status].tone">{{ STATUS[connection.status].label }}</UiCommonBadge>
            </div>
            <p class="text-xs text-slate-500">
              GBP アカウント: {{ connection.gbpAccounts.map(account => account.accountName).join('、') }}
              ・連携日 {{ formatDate(connection.connectedAt) }}
            </p>
            <p v-if="connection.lastError" class="text-xs text-rose-700">{{ connection.lastError }}</p>
          </div>
          <div v-if="connection.status !== 'revoked'" class="flex gap-2">
            <UiCommonButton
              v-if="connection.status === 'error'"
              size="sm"
              icon="refresh"
              :is-loading="busyId === connection.id"
              @click="onReauthorize(connection)"
            >
              再認証
            </UiCommonButton>
            <UiCommonButton size="sm" variant="secondary" @click="disconnectTarget = connection">解除</UiCommonButton>
          </div>
          <UiCommonButton v-else size="sm" variant="secondary" :is-loading="busyId === connection.id" @click="onReauthorize(connection)">
            再連携
          </UiCommonButton>
        </li>
      </ul>
    </UiCommonCard>

    <UiCommonCard title="Google と連携する">
      <form v-if="isMock" class="space-y-4" @submit.prevent="onConnect">
        <UiCommonAlert tone="info" title="デモ版の動作について">
          本番では Google のログイン画面に移動し、ビジネスプロフィールの管理権限（business.manage）への同意を求めます。
          デモ版では入力したアカウントで同意した扱いになり、サンプルのロケーションが 1 件追加されます。
        </UiCommonAlert>
        <UiInputTextField
          v-model="googleEmail"
          label="Google アカウント"
          type="email"
          placeholder="example@gmail.com"
          hint="店舗のビジネスプロフィールのオーナーまたは管理者になっているアカウント"
          :error="emailError"
          autocomplete="email"
        />
        <UiCommonAlert v-if="connectState.errorMessage.value" tone="danger">{{ connectState.errorMessage.value }}</UiCommonAlert>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <NuxtLink :to="adminPath('/stores')" class="text-sm text-brand-700 hover:underline">連携後は店舗画面から取り込めます</NuxtLink>
          <UiCommonButton type="submit" icon="google" :is-loading="connectState.isPending.value">Google で連携する</UiCommonButton>
        </div>
      </form>
      <div v-else class="space-y-4">
        <p class="text-sm text-slate-700">
          ビジネスプロフィールのオーナーまたは管理者の Google アカウントで、管理権限（business.manage）を許可します。
        </p>
        <UiCommonAlert v-if="authState.errorMessage.value" tone="danger">{{ authState.errorMessage.value }}</UiCommonAlert>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <NuxtLink :to="adminPath('/stores')" class="text-sm text-brand-700 hover:underline">連携後は店舗画面から取り込めます</NuxtLink>
          <UiCommonButton icon="google" :is-loading="authState.isPending.value" :is-disabled="!oauthClient" @click="onStartGoogleAuth">
            Google で連携する
          </UiCommonButton>
        </div>
      </div>
    </UiCommonCard>

    <p class="text-xs text-slate-500">
      GBP API の利用には Google への申請と承認が必要です（未承認の間は API が利用できません）。
    </p>

    <UiCommonModal v-model="isDisconnectOpen" title="連携を解除しますか？">
      <div class="space-y-3 text-sm text-slate-700">
        <p>「{{ disconnectTarget?.googleEmail }}」との連携を解除し、Google 側のアクセス許可も取り消します。</p>
        <p class="text-slate-500">取り込み済みの店舗と口コミ URL はそのまま使えます。新しい店舗の取り込みには再度の連携が必要です。</p>
        <UiCommonAlert v-if="rowState.errorMessage.value" tone="danger">{{ rowState.errorMessage.value }}</UiCommonAlert>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="disconnectTarget = null">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="rowState.isPending.value" @click="onDisconnect">解除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
