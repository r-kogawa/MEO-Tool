<script setup lang="ts">
import type { OrgLimits } from '~/types/domain'
import type { OpsOrganizationDetail } from '~/composables/useOps'

definePageMeta({ layout: 'ops' })
useSeoMeta({ title: '組織詳細（運営）', robots: 'noindex, nofollow' })

const route = useRoute()
const orgId = String(route.params.orgId)
const { fetchOrganization, updateStatus, updatePlan } = useOps()
const detail = ref<OpsOrganizationDetail | null>(null)
const { show } = useToast()
const loadState = useActionState()
const statusAction = useActionState()
const planAction = useActionState()

const LIMIT_FIELDS: { key: keyof OrgLimits; label: string }[] = [
  { key: 'maxStores', label: '店舗数' },
  { key: 'maxSurveys', label: 'アンケート数' },
  { key: 'maxKeywords', label: '順位キーワード数' },
  { key: 'maxMembers', label: 'メンバー数' },
  { key: 'monthlyReviewDrafts', label: '口コミ生成（月）' },
  { key: 'monthlyRankChecks', label: '順位計測（月）' },
]

// 入力は文字列で持ち、保存時に数値へ変換する
const plan = ref('')
const limitInputs = ref<Record<keyof OrgLimits, string>>({
  maxStores: '', maxSurveys: '', maxKeywords: '', maxMembers: '', monthlyReviewDrafts: '', monthlyRankChecks: '',
})

function resetForm(): void {
  if (!detail.value) return
  plan.value = detail.value.org.plan
  for (const field of LIMIT_FIELDS) limitInputs.value[field.key] = String(detail.value.org.limits[field.key])
}

async function load(): Promise<void> {
  detail.value = (await loadState.run(() => fetchOrganization(orgId))) ?? null
  resetForm()
}
onMounted(load)

// 外部 API 経由の capturedAt は日付として読めない文字列があり得る。その場合は生の文字列を出す
function formatCapturedAt(value: string | null): string {
  if (!value) return '—'
  return Number.isNaN(Date.parse(value)) ? value : formatDateTime(value)
}

// 登録情報カードの行。無い値は「—」
const signupRows = computed<{ label: string; value: string }[]>(() => {
  const signup = detail.value?.signup
  if (!signup) return []
  const source = signup.source
  return [
    { label: '電話番号', value: signup.phone },
    { label: '業種', value: INDUSTRY_LABELS[signup.industry] },
    { label: '運営店舗数', value: STORE_COUNT_LABELS[signup.storeCount] },
    { label: '登録方法', value: SIGNUP_VIA_LABELS[signup.via] },
    { label: 'ref', value: source?.ref ?? '—' },
    { label: 'utm_source', value: source?.utmSource ?? '—' },
    { label: 'utm_medium', value: source?.utmMedium ?? '—' },
    { label: 'utm_campaign', value: source?.utmCampaign ?? '—' },
    { label: '最初に開いたページ', value: source?.landingPath ?? '—' },
    { label: '経路の保存日時', value: formatCapturedAt(source?.capturedAt ?? null) },
  ].map(row => ({ ...row, value: row.value || '—' }))
})

const isSuspended = computed(() => detail.value?.org.status === 'suspended')

async function onToggleStatus(): Promise<void> {
  const next = isSuspended.value ? 'active' : 'suspended'
  const isDone = await statusAction.run(async () => {
    await updateStatus(orgId, next)
    return true
  })
  if (!isDone) return
  show(next === 'active' ? '利用を再開しました' : '利用を停止しました')
  await load()
}

/**
 * 空欄・数値でない入力は 0 にせず null として送り、サーバーに拒否させる。
 * NaN は callable の SDK が送信前に例外にする（汎用エラーになる）ため使わない
 */
function toLimitValue(input: string): number | null {
  const value = input.trim() === '' ? Number.NaN : Number(input)
  return Number.isFinite(value) ? value : null
}

async function onSavePlan(): Promise<void> {
  const limits = Object.fromEntries(LIMIT_FIELDS.map(field => [field.key, toLimitValue(limitInputs.value[field.key])])) as unknown as OrgLimits
  const isDone = await planAction.run(async () => {
    await updatePlan(orgId, plan.value.trim(), limits)
    return true
  })
  if (!isDone) return
  show('プランと上限を更新しました')
  await load()
}
</script>

<template>
  <p v-if="loadState.isPending.value && !detail" class="text-sm text-slate-500">読み込み中…</p>

  <div v-else-if="!detail" class="space-y-4">
    <UiCommonAlert tone="danger">{{ loadState.errorMessage.value ?? '組織が見つかりません。' }}</UiCommonAlert>
    <UiCommonButton to="/ops/organizations" variant="secondary">組織一覧へ</UiCommonButton>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader :title="detail.org.name" back-to="/ops/organizations" back-label="組織一覧">
      <template #badge>
        <UiCommonBadge :tone="detail.org.type === 'corporate' ? 'brand' : 'neutral'">{{ ORG_TYPE_LABELS[detail.org.type] }}</UiCommonBadge>
        <UiCommonBadge :tone="detail.org.status === 'active' ? 'success' : 'danger'">{{ ORG_STATUS_LABELS[detail.org.status] }}</UiCommonBadge>
      </template>
    </UiCommonPageHeader>

    <UiCommonCard title="利用状態" description="利用停止にすると、この組織の公開アンケートもすべて受付停止になります。">
      <div class="flex flex-wrap items-center gap-3">
        <UiCommonButton :variant="isSuspended ? 'primary' : 'danger'" :is-loading="statusAction.isPending.value" @click="onToggleStatus">
          {{ isSuspended ? '利用を再開する' : '利用を停止する' }}
        </UiCommonButton>
        <p class="text-sm text-slate-500">作成日: {{ formatDate(detail.org.createdAt) }}</p>
      </div>
      <UiCommonAlert v-if="statusAction.errorMessage.value" tone="danger" class="mt-3">{{ statusAction.errorMessage.value }}</UiCommonAlert>
    </UiCommonCard>

    <UiCommonCard title="登録情報">
      <dl v-if="detail.signup" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div v-for="row in signupRows" :key="row.label">
          <dt class="text-xs text-slate-500">{{ row.label }}</dt>
          <dd class="break-all">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="text-sm text-slate-500">登録情報はありません（この項目を追加する前に登録された組織です）。</p>
    </UiCommonCard>

    <UiCommonCard title="プランと上限">
      <form class="space-y-4" @submit.prevent="onSavePlan">
        <div class="max-w-xs">
          <UiInputTextField v-model="plan" label="プラン名" is-required />
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <UiInputTextField
            v-for="field in LIMIT_FIELDS"
            :key="field.key"
            v-model="limitInputs[field.key]"
            :label="field.label"
            type="number"
          />
        </div>
        <UiCommonAlert v-if="planAction.errorMessage.value" tone="danger">{{ planAction.errorMessage.value }}</UiCommonAlert>
        <div class="flex gap-2">
          <UiCommonButton type="submit" :is-loading="planAction.isPending.value">保存する</UiCommonButton>
          <UiCommonButton variant="ghost" @click="resetForm">元に戻す</UiCommonButton>
        </div>
      </form>
    </UiCommonCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiCommonCard title="今月の利用量">
        <dl v-if="detail.usage" class="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt class="text-xs text-slate-500">回答</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ detail.usage.responses }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">口コミ生成</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ detail.usage.reviewDrafts }}</dd>
            <dd class="text-xs text-slate-400">/ {{ detail.org.limits.monthlyReviewDrafts }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">順位計測</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ detail.usage.rankChecks }}</dd>
            <dd class="text-xs text-slate-400">/ {{ detail.org.limits.monthlyRankChecks }}</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-slate-500">今月の利用はまだありません。</p>
      </UiCommonCard>

      <UiCommonCard title="Google 連携">
        <ul v-if="detail.connections.length > 0" class="divide-y divide-slate-100 text-sm">
          <li v-for="connection in detail.connections" :key="connection.id" class="flex items-center justify-between gap-3 py-2">
            <span>
              <span class="block">{{ connection.googleEmail }}</span>
              <span v-if="connection.lastError" class="block text-xs text-rose-700">{{ connection.lastError }}</span>
            </span>
            <UiCommonBadge :tone="connection.status === 'active' ? 'success' : connection.status === 'error' ? 'danger' : 'neutral'">
              {{ connection.status === 'active' ? '連携中' : connection.status === 'error' ? 'エラー' : '解除済み' }}
            </UiCommonBadge>
          </li>
        </ul>
        <p v-else class="text-sm text-slate-500">連携していません。</p>
      </UiCommonCard>

      <UiCommonCard :title="`メンバー（${detail.memberList.length} 名）`">
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="member in detail.memberList" :key="member.uid" class="flex items-center justify-between gap-3 py-2">
            <span>
              <span class="block">{{ member.displayName }}</span>
              <span class="block text-xs text-slate-500">{{ member.email }}</span>
            </span>
            <UiCommonBadge>{{ ROLE_LABELS[member.role] }}</UiCommonBadge>
          </li>
        </ul>
      </UiCommonCard>

      <UiCommonCard :title="`店舗（${detail.storeList.length} 店舗）`">
        <ul v-if="detail.storeList.length > 0" class="divide-y divide-slate-100 text-sm">
          <li v-for="store in detail.storeList" :key="store.id" class="flex items-center justify-between gap-3 py-2">
            <span>
              <span class="block">{{ store.name }}</span>
              <span class="block text-xs text-slate-500">{{ store.address }}</span>
            </span>
            <UiCommonBadge :tone="store.status === 'active' ? 'success' : 'neutral'">{{ store.status === 'active' ? '有効' : 'アーカイブ' }}</UiCommonBadge>
          </li>
        </ul>
        <p v-else class="text-sm text-slate-500">店舗がありません。</p>
      </UiCommonCard>
    </div>
  </div>
</template>
