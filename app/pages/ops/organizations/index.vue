<script setup lang="ts">
import type { OrgStatus, OrgType } from '~/types/domain'

definePageMeta({ layout: 'ops' })
useSeoMeta({ title: '組織一覧（運営）', robots: 'noindex, nofollow' })

const { organizations } = useOps()

const keyword = ref('')
const typeFilter = ref<OrgType | null>(null)
const statusFilter = ref<OrgStatus | null>(null)

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return organizations.value.filter(item =>
    (query === '' || item.org.name.toLowerCase().includes(query) || item.ownerEmail.toLowerCase().includes(query))
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

    <div class="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
      <UiInputTextField v-model="keyword" label="組織名・オーナーのメールで検索" placeholder="例: ハナミ" />
      <UiInputSelectField v-model="typeFilter" label="種別" :options="[...TYPE_OPTIONS]" />
      <UiInputSelectField v-model="statusFilter" label="状態" :options="[...STATUS_OPTIONS]" />
    </div>

    <UiCommonCard is-flush>
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[48rem] text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th class="px-4 py-3 font-medium">組織</th>
              <th class="px-4 py-3 font-medium">プラン</th>
              <th class="px-4 py-3 font-medium">状態</th>
              <th class="px-4 py-3 text-right font-medium">店舗</th>
              <th class="px-4 py-3 text-right font-medium">メンバー</th>
              <th class="px-4 py-3 font-medium">オーナー</th>
              <th class="px-4 py-3 font-medium">Google 連携</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in filtered" :key="item.org.id" class="hover:bg-slate-50">
              <td class="px-4 py-3">
                <NuxtLink :to="`/ops/organizations/${item.org.id}`" class="font-medium text-brand-700 hover:underline">{{ item.org.name }}</NuxtLink>
                <div class="mt-1">
                  <UiCommonBadge :tone="item.org.type === 'corporate' ? 'brand' : 'neutral'">{{ ORG_TYPE_LABELS[item.org.type] }}</UiCommonBadge>
                </div>
              </td>
              <td class="px-4 py-3">{{ item.org.plan }}</td>
              <td class="px-4 py-3">
                <UiCommonBadge :tone="item.org.status === 'active' ? 'success' : 'danger'">{{ ORG_STATUS_LABELS[item.org.status] }}</UiCommonBadge>
              </td>
              <td class="px-4 py-3 text-right tabular-nums">{{ item.stores }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ item.members }}</td>
              <td class="px-4 py-3">
                <span class="block">{{ item.ownerName }}</span>
                <span class="block text-xs text-slate-500">{{ item.ownerEmail }}</span>
              </td>
              <td class="px-4 py-3">
                <UiCommonBadge v-if="item.hasConnectionError" tone="danger">エラーあり</UiCommonBadge>
                <span v-else class="text-slate-400">—</span>
              </td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="7" class="px-4 py-10 text-center text-slate-500">条件に合う組織がありません。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>
  </div>
</template>
