<script setup lang="ts">
// F-18 ダッシュボード。個人: 単一店舗のサマリー / 法人: 店舗横断の比較表 / staff: 担当店舗のみ

definePageMeta({ layout: 'admin' })
useHead({ title: 'ダッシュボード' })

const { org, isCorporate, canManage, visibleStores, hasMultipleStores, adminPath, storeName } = useCurrentOrg()
const {
  period,
  storeId,
  current,
  previous,
  averageRating,
  storeComparison,
  topKeywords,
  publishedSurveys,
  hasConnectionError,
  isConnected,
} = useDashboard()
const { warnings: usageWarnings } = useUsage()

function ratePercent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100)
}

const eligibleRate = computed(() => ratePercent(current.value.eligible, current.value.total))
const previousEligibleRate = computed(() => ratePercent(previous.value.eligible, previous.value.total))
const eligibleRateDiff = computed(() =>
  eligibleRate.value === null || previousEligibleRate.value === null ? null : eligibleRate.value - previousEligibleRate.value)

const singleStore = computed(() => (visibleStores.value.length === 1 ? visibleStores.value[0] : null))
const hasStores = computed(() => visibleStores.value.length > 0)
</script>

<template>
  <div class="space-y-6">
    <UiCommonPageHeader title="ダッシュボード" :description="org ? `${org.name} の直近の状況` : undefined" />

    <!-- 警告（Google 連携・利用量） -->
    <div v-if="canManage && (hasConnectionError || !isConnected || usageWarnings.length > 0)" class="space-y-3">
      <UiCommonAlert v-if="hasConnectionError" tone="danger" title="Google 連携でエラーが発生しています">
        再認証が必要です。
        <NuxtLink :to="adminPath('/settings/google')" class="font-medium underline">Google 連携を確認する</NuxtLink>
      </UiCommonAlert>
      <UiCommonAlert v-else-if="!isConnected" tone="warning" title="Google ビジネスプロフィールと未連携です">
        店舗の取り込みには連携が必要です。
        <NuxtLink :to="adminPath('/settings/google')" class="font-medium underline">Google と連携する</NuxtLink>
      </UiCommonAlert>
      <UiCommonAlert v-if="usageWarnings.length > 0" tone="warning" title="利用上限に近づいています">
        {{ usageWarnings.map(item => `${item.label}: ${item.used} / ${item.limit}${item.unit}`).join('、') }}
        <NuxtLink :to="adminPath('/settings/usage')" class="ml-1 font-medium underline">利用状況を見る</NuxtLink>
      </UiCommonAlert>
    </div>

    <UiCommonAlert v-if="!hasStores" tone="info" title="表示できる店舗がありません">
      <template v-if="canManage">
        <NuxtLink :to="adminPath('/stores')" class="font-medium underline">店舗を取り込む</NuxtLink>と、回答や順位がここに表示されます。
      </template>
      <template v-else>担当店舗が割り当てられていません。管理者にお問い合わせください。</template>
    </UiCommonAlert>

    <!-- フィルタ（1 行・グラフより上） -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="集計期間">
        <button
          v-for="days in DASHBOARD_PERIODS"
          :key="days"
          type="button"
          class="rounded-md px-3 py-1.5 text-sm"
          :class="period === days ? 'bg-brand-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'"
          :aria-pressed="period === days"
          @click="period = days"
        >
          直近 {{ days }} 日
        </button>
      </div>
      <AdminCommonStoreFilter v-model="storeId" />
      <p v-if="singleStore" class="text-sm text-slate-500">{{ singleStore.name }}</p>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiCommonStatCard label="回答数" :value="current.total" :diff="current.total - previous.total" diff-unit="件" sub="前期間比" />
      <UiCommonStatCard
        label="条件合致率"
        :value="eligibleRate === null ? '—' : `${eligibleRate}%`"
        :diff="eligibleRateDiff"
        diff-unit="pt"
        :sub="`${current.eligible} 件が合致`"
      />
      <UiCommonStatCard
        label="Google 遷移数"
        :value="current.redirected"
        :diff="current.redirected - previous.redirected"
        diff-unit="件"
        :sub="`合致者の ${formatPercent(current.redirected, current.eligible)}`"
      />
      <UiCommonStatCard label="平均評価" :value="averageRating === null ? '—' : `★${averageRating.toFixed(1)}`" sub="総合満足度（5 段階）" />
    </div>

    <!-- 法人: 店舗横断の比較表 -->
    <UiCommonCard
      v-if="isCorporate && hasMultipleStores && storeId === null"
      title="店舗別の比較"
      :description="`直近 ${period} 日の回答と、最も順位の高いキーワード`"
      is-flush
    >
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[640px] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-5 py-2.5 font-medium">店舗</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">回答数</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">条件合致率</th>
              <th scope="col" class="px-3 py-2.5 text-right font-medium">Google 遷移数</th>
              <th scope="col" class="px-5 py-2.5 font-medium">最上位キーワード</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in storeComparison" :key="row.store.id" class="hover:bg-slate-50">
              <th scope="row" class="px-5 py-3 text-left font-medium">
                <NuxtLink :to="adminPath(`/stores/${row.store.id}`)" class="hover:text-brand-700 hover:underline">{{ row.store.name }}</NuxtLink>
              </th>
              <td class="px-3 py-3 text-right tabular-nums">{{ row.total }}</td>
              <td class="px-3 py-3 text-right tabular-nums">{{ formatPercent(row.eligible, row.total) }}</td>
              <td class="px-3 py-3 text-right tabular-nums">{{ row.redirected }}</td>
              <td class="px-5 py-3">
                <span v-if="row.bestKeyword" class="flex items-center gap-2">
                  <span class="text-slate-700">{{ row.bestKeyword.keyword.keyword }}</span>
                  <span class="font-semibold tabular-nums">{{ row.bestKeyword.latest?.rank }}位</span>
                  <RankingCommonRankDiff :diff="row.bestKeyword.dayDiff" label="前日比" />
                </span>
                <span v-else class="text-slate-400">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCommonCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiCommonCard title="主要キーワードの順位" description="最新の計測結果と前日比">
        <template #actions>
          <NuxtLink :to="adminPath('/rankings')" class="text-sm text-brand-700 hover:underline">すべて見る</NuxtLink>
        </template>
        <p v-if="topKeywords.length === 0" class="text-sm text-slate-500">
          計測中のキーワードはありません。
          <NuxtLink v-if="canManage" :to="adminPath('/rankings')" class="text-brand-700 underline">キーワードを追加する</NuxtLink>
        </p>
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="row in topKeywords" :key="row.keyword.id">
            <NuxtLink :to="adminPath(`/rankings/${row.keyword.id}`)" class="flex items-center gap-3 py-2.5 hover:bg-slate-50">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-slate-800">{{ row.keyword.keyword }}</p>
                <p v-if="hasMultipleStores" class="truncate text-xs text-slate-500">{{ row.storeName }}</p>
              </div>
              <RankingCommonRankTrendChart variant="spark" :points="row.recentPoints" :range="RANK_RANGE" :label="`${row.keyword.keyword} の順位推移`" />
              <span class="w-16 text-right text-sm font-semibold tabular-nums">
                {{ row.latest?.rank == null ? '圏外' : `${row.latest.rank}位` }}
              </span>
              <span class="w-10 text-right"><RankingCommonRankDiff :diff="row.dayDiff" label="前日比" /></span>
            </NuxtLink>
          </li>
        </ul>
      </UiCommonCard>

      <UiCommonCard title="公開中のアンケート">
        <template #actions>
          <NuxtLink :to="adminPath('/surveys')" class="text-sm text-brand-700 hover:underline">すべて見る</NuxtLink>
        </template>
        <p v-if="publishedSurveys.length === 0" class="text-sm text-slate-500">公開中のアンケートはありません。</p>
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="survey in publishedSurveys" :key="survey.id">
            <NuxtLink :to="adminPath(`/surveys/${survey.id}`)" class="flex items-center gap-3 py-2.5 hover:bg-slate-50">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-slate-800">{{ survey.title }}</p>
                <p class="truncate text-xs text-slate-500">{{ storeName(survey.storeId) }}</p>
              </div>
              <UiCommonBadge v-if="survey.hasUnpublishedChanges" tone="warning">未公開の変更あり</UiCommonBadge>
              <AdminCommonSurveyStatusBadge :status="survey.status" />
            </NuxtLink>
          </li>
        </ul>
      </UiCommonCard>
    </div>
  </div>
</template>
