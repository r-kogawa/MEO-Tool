<script setup lang="ts">
import type { RankSearch } from '~/types/domain'
import { findMunicipalityByLabel, type Municipality } from '~/utils/geo/municipality'
import { RANK_DISCLAIMER, rankErrorText } from '~/utils/rankKeyword'

// その場計測。キーワードを登録せずに、地域 + キーワードで Google マップの上位 20 件を計測する（owner / admin）

definePageMeta({ layout: 'admin' })
useHead({ title: 'その場で計測' })

const { canManage, adminPath, storeName } = useCurrentOrg()
const { searches, current, startSearch, select } = useRankSearch()
const { show } = useToast()
const state = useActionState()

const isRegisterOpen = ref(false)
const registerArea = ref<Municipality | null>(null)

const isRunning = computed(() => current.value?.status === 'queued' || current.value?.status === 'running')

async function onSubmit(input: { keyword: string; area: Municipality; storeId: string | null }): Promise<void> {
  await state.run(() => startSearch({
    keyword: input.keyword,
    searchLocation: { lat: input.area.lat, lng: input.area.lng, label: input.area.label },
    storeId: input.storeId,
  }))
  if (state.errorMessage.value) show(state.errorMessage.value, 'danger')
}

function rankText(search: RankSearch): string {
  if (search.status === 'error') return '取得エラー'
  if (search.status !== 'done') return '計測中'
  if (!search.storeId) return '—'
  return search.rank === null ? '圏外' : `${search.rank}位`
}

function onOpenRegister(search: RankSearch): void {
  registerArea.value = findMunicipalityByLabel(search.searchLocation.label)
  isRegisterOpen.value = true
}

function onRegistered(keyword: string): void {
  show(`「${keyword}」を定期計測に追加しました`)
}
</script>

<template>
  <div v-if="!canManage" class="space-y-4">
    <UiCommonPageHeader title="その場で計測" :back-to="adminPath('/rankings')" back-label="順位一覧へ" />
    <UiCommonAlert tone="warning">その場計測は owner / admin のみ利用できます。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader
      title="その場で計測"
      description="キーワードを登録せずに、Google マップでの上位 20 件と自店の順位をその場で確認します"
      :back-to="adminPath('/rankings')"
      back-label="順位一覧へ"
    />
    <UiCommonAlert tone="info">{{ RANK_DISCLAIMER }}1 回の計測で、今月の順位計測数を 1 回使います。</UiCommonAlert>

    <UiCommonCard title="計測する条件">
      <RankingSearchForm :is-pending="state.isPending.value || isRunning" @submit="onSubmit" />
    </UiCommonCard>

    <UiCommonCard v-if="current" :title="`「${current.keyword}」の順位計測`" :description="`${current.searchLocation.label}${current.storeId ? `・${storeName(current.storeId)}` : ''}`" is-flush>
      <div class="flex items-baseline gap-3 px-5 py-4">
        <span class="text-sm text-slate-500">検索順位</span>
        <span class="text-2xl font-semibold tabular-nums" :class="current.status === 'error' ? 'text-amber-700' : 'text-slate-900'">{{ rankText(current) }}</span>
      </div>
      <p v-if="isRunning" class="border-t border-slate-100 px-5 py-4 text-sm text-slate-500" role="status">計測中…（10 秒ほどかかります）</p>
      <div v-else-if="current.status === 'error'" class="border-t border-slate-100 p-5">
        <UiCommonAlert tone="warning">{{ rankErrorText(current.errorCode) }}。しばらく時間を置いてから再度お試しください。</UiCommonAlert>
      </div>
      <template v-else>
        <p v-if="current.results.length === 0" class="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">検索結果がありませんでした。</p>
        <RankingCommonRankResultsTable v-else :results="current.results" :own-rank="current.rank" />
        <div v-if="current.storeId" class="flex justify-end border-t border-slate-100 px-5 py-3">
          <UiCommonButton size="sm" variant="secondary" icon="plus" @click="onOpenRegister(current)">このキーワードを登録</UiCommonButton>
        </div>
      </template>
    </UiCommonCard>

    <UiCommonCard title="最近の計測" description="直近 30 日・30 件まで" is-flush>
      <p v-if="searches.length === 0" class="p-5 text-sm text-slate-500">まだ計測していません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="search in searches" :key="search.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-slate-50"
            :class="search.id === current?.id ? 'bg-brand-50' : ''"
            @click="select(search.id)"
          >
            <span class="min-w-0 flex-1 truncate font-medium text-slate-800">{{ search.keyword }}</span>
            <span class="text-xs text-slate-500">{{ search.searchLocation.label }}</span>
            <span class="w-16 text-right tabular-nums text-slate-700">{{ rankText(search) }}</span>
            <span class="w-28 text-right text-xs text-slate-400">{{ formatDate(search.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </UiCommonCard>

    <RankingRankingsKeywordFormModal
      v-model="isRegisterOpen"
      :initial-store-id="current?.storeId ?? null"
      :initial-keyword="current?.keyword ?? ''"
      :initial-area="registerArea"
      @created="onRegistered"
    />
  </div>
</template>
