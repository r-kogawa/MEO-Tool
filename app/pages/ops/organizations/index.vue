<script setup lang="ts">
import type { OrgStatus, OrgType } from '~/types/domain'
import type { OpsOrganizationSummary } from '~/composables/useOps'

definePageMeta({ layout: 'ops' })
useSeoMeta({ title: '組織一覧（運営）', robots: 'noindex, nofollow' })

const { fetchOrganizations } = useOps()
const organizations = ref<OpsOrganizationSummary[]>([])
const loadState = useActionState()
// 一覧は開いたときに 1 回だけ読む（購読しない）
onMounted(async () => {
  organizations.value = (await loadState.run(fetchOrganizations)) ?? []
})

const keyword = ref('')
const typeFilter = ref<OrgType | null>(null)
const statusFilter = ref<OrgStatus | null>(null)

// 検索対象の文字列。経路の値は無い組織（signup が null）や未設定の項目を飛ばす
function searchTexts(item: OpsOrganizationSummary): string[] {
  const source = item.signup?.source
  return [item.org.name, item.ownerEmail, source?.ref, source?.utmSource, source?.utmMedium, source?.utmCampaign]
    .filter((text): text is string => typeof text === 'string')
}

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return organizations.value.filter(item =>
    (query === '' || searchTexts(item).some(text => text.toLowerCase().includes(query)))
    && (typeFilter.value === null || item.org.type === typeFilter.value)
    && (statusFilter.value === null || item.org.status === statusFilter.value))
})

const TYPE_OPTIONS = [
  { value: null, label: 'すべての種別' },
  { value: 'individual', label: '個人' },
  { value: 'corporate', label: '法人' },
] as const
const STATUS_OPTIONS = [
  { value: null, label: 'すべての状態' },
  { value: 'active', label: '利用中' },
  { value: 'suspended', label: '利用停止' },
] as const
</script>

<template>
  <div>
    <UiCommonPageHeader title="組織一覧" :description="`全 ${organizations.length} 組織`" />
    <UiCommonAlert v-if="loadState.errorMessage.value" tone="danger" class="mb-4">{{ loadState.errorMessage.value }}</UiCommonAlert>

    <div class="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
      <UiInputTextField v-model="keyword" label="組織名・オーナーのメール・登録経路で検索" placeholder="例: ハナミ" />
      <UiInputSelectField v-model="typeFilter" label="種別" :options="[...TYPE_OPTIONS]" />
      <UiInputSelectField v-model="statusFilter" label="状態" :options="[...STATUS_OPTIONS]" />
    </div>

    <UiCommonCard is-flush>
      <div class="relative overflow-x-auto">
        <!-- 列が多いため折り返さず、長い文字列は列ごとの最大幅で省略する（全文は title で見せる）。収まらなければカード内で横スクロール -->
        <table class="w-full whitespace-nowrap text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th class="px-3 py-3 font-medium">組織</th>
              <th class="px-3 py-3 font-medium">プラン</th>
              <th class="px-3 py-3 font-medium">状態</th>
              <th class="px-3 py-3 text-right font-medium">店舗</th>
              <th class="px-3 py-3 text-right font-medium">メンバー</th>
              <th class="px-3 py-3 font-medium">オーナー</th>
              <th class="px-3 py-3 font-medium">電話番号</th>
              <th class="px-3 py-3 font-medium">登録経路</th>
              <th class="px-3 py-3 font-medium">登録日時</th>
              <th class="px-3 py-3 font-medium">Google 連携</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in filtered" :key="item.org.id" class="hover:bg-slate-50">
              <td class="px-3 py-3">
                <NuxtLink :to="`/ops/organizations/${item.org.id}`" :title="item.org.name" class="block max-w-36 truncate font-medium text-brand-700 hover:underline">{{ item.org.name }}</NuxtLink>
                <div class="mt-1">
                  <UiCommonBadge :tone="item.org.type === 'corporate' ? 'brand' : 'neutral'">{{ ORG_TYPE_LABELS[item.org.type] }}</UiCommonBadge>
                </div>
              </td>
              <td class="px-3 py-3">
                <span :title="item.org.plan" class="block max-w-24 truncate">{{ item.org.plan }}</span>
              </td>
              <td class="px-3 py-3">
                <UiCommonBadge :tone="item.org.status === 'active' ? 'success' : 'danger'">{{ ORG_STATUS_LABELS[item.org.status] }}</UiCommonBadge>
              </td>
              <td class="px-3 py-3 text-right tabular-nums">{{ item.stores }}</td>
              <td class="px-3 py-3 text-right tabular-nums">{{ item.members }}</td>
              <td class="px-3 py-3">
                <span :title="item.ownerName" class="block max-w-36 truncate">{{ item.ownerName }}</span>
                <span :title="item.ownerEmail" class="block max-w-36 truncate text-xs text-slate-500">{{ item.ownerEmail }}</span>
              </td>
              <td class="px-3 py-3 tabular-nums">{{ item.signup?.phone ?? '—' }}</td>
              <td class="px-3 py-3">
                <span :title="signupSourceLabel(item.signup?.source ?? null) ?? undefined" class="block max-w-24 truncate">{{ signupSourceLabel(item.signup?.source ?? null) ?? '—' }}</span>
                <span v-if="item.signup?.via === 'externalApi'" class="block text-xs text-slate-500">外部 API</span>
              </td>
              <td class="px-3 py-3 tabular-nums">
                <span class="block">{{ formatDate(item.org.createdAt) }}</span>
                <span class="block text-xs text-slate-500">{{ formatTime(item.org.createdAt) }}</span>
              </td>
              <td class="px-3 py-3">
                <UiCommonBadge v-if="item.hasConnectionError" tone="danger">エラーあり</UiCommonBadge>
                <span v-else class="text-slate-400">—</span>
              </td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="10" class="px-4 py-10 text-center text-slate-500">{{ loadState.isPending.value ? '読み込み中…' : '条件に合う組織がありません。' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>
  </div>
</template>
