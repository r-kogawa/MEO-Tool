<script setup lang="ts">
// F-17 1 キーワードの順位推移と、計測日の上位（競合）
import type { RankSnapshot } from '~/types/domain'
import { RANK_DISCLAIMER, rankErrorText } from '~/utils/rankKeyword'

definePageMeta({ layout: 'admin' })

const route = useRoute()
const keywordId = String(route.params.keywordId)
const { adminPath } = useCurrentOrg()
const {
  keyword, storeName, period, periodHistory, latest, bestRank, selectedDay, selectedSnapshot,
  results, isLoadingResults, resultsError,
} = useRankHistory(keywordId)

useHead({ title: () => (keyword.value ? `「${keyword.value.keyword}」の順位` : '検索順位') })

const chartPoints = computed(() => periodHistory.value.map(snapshot => ({ day: snapshot.checkedOn, rank: snapshot.rank, isError: snapshot.status === 'error' })))
/** 表は新しい日付を上に。前日との差も並べる */
const tableRows = computed(() =>
  periodHistory.value
    .map((snapshot, index) => {
      const previous = periodHistory.value[index - 1]
      const diff = snapshot.rank === null || previous?.rank == null ? null : previous.rank - snapshot.rank
      return { snapshot, diff }
    })
    .reverse())

const outOfRangeDays = computed(() => periodHistory.value.filter(snapshot => snapshot.status === 'ok' && snapshot.rank === null).length)
const errorDays = computed(() => periodHistory.value.filter(snapshot => snapshot.status === 'error').length)

function rankText(snapshot: RankSnapshot | null | undefined): string {
  if (snapshot?.status === 'error') return '取得エラー'
  return snapshot?.rank == null ? `${RANK_RANGE}位圏外` : `${snapshot.rank}位`
}

function onSelectDay(day: string): void {
  selectedDay.value = day
}
</script>

<template>
  <div v-if="!keyword" class="space-y-4">
    <UiCommonPageHeader title="キーワードが見つかりません" :back-to="adminPath('/rankings')" back-label="順位一覧へ" />
    <UiCommonAlert tone="warning">このキーワードは存在しないか、閲覧する権限がありません。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader
      :title="keyword.keyword"
      :description="`${storeName}・計測地点: ${keyword.searchLocation.label}`"
      :back-to="adminPath('/rankings')"
      back-label="順位一覧へ"
    >
      <template #badge>
        <UiCommonBadge v-if="!keyword.isActive">停止中</UiCommonBadge>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert tone="info">{{ RANK_DISCLAIMER }}</UiCommonAlert>

    <!-- 期間フィルタ（1 行・グラフより上） -->
    <div class="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="表示期間">
      <button
        v-for="days in RANK_PERIODS"
        :key="days"
        type="button"
        class="rounded-md px-3 py-1.5 text-sm"
        :class="period === days ? 'bg-brand-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'"
        :aria-pressed="period === days"
        @click="period = days"
      >
        {{ days }} 日
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <UiCommonStatCard label="最新順位" :value="rankText(latest)" :sub="latest ? formatShortDate(latest.checkedOn) : undefined" />
      <UiCommonStatCard label="期間内の最高順位" :value="bestRank === null ? '—' : `${bestRank}位`" :sub="`直近 ${period} 日`" />
      <UiCommonStatCard label="圏外だった日" :value="`${outOfRangeDays}日`" :sub="`${periodHistory.length} 日中${errorDays > 0 ? `・取得エラー ${errorDays} 日` : ''}`" />
    </div>

    <UiCommonCard title="順位の推移" description="グラフの日付をクリックすると、その日の上位 20 店舗を表示します（上が 1 位。下端の灰色は圏外、黄色は取得エラーの日）">
      <RankingCommonRankTrendChart
        variant="full"
        :points="chartPoints"
        :range="RANK_RANGE"
        :selected-day="selectedSnapshot?.checkedOn ?? null"
        :label="`${keyword.keyword} の順位推移`"
        @select="onSelectDay"
      />
    </UiCommonCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiCommonCard
        title="上位の店舗"
        :description="selectedSnapshot ? `${formatDate(`${selectedSnapshot.checkedOn}T00:00:00`)} の計測結果（上位 ${selectedSnapshot.resultCount} 件）` : undefined"
        is-flush
      >
        <p v-if="!selectedSnapshot" class="p-5 text-sm text-slate-500">計測結果がありません。</p>
        <div v-else-if="selectedSnapshot.status === 'error'" class="p-5">
          <UiCommonAlert tone="warning">{{ rankErrorText(selectedSnapshot.errorCode) }}。この日の順位と上位店舗は取得できませんでした。</UiCommonAlert>
        </div>
        <p v-else-if="isLoadingResults" class="p-5 text-sm text-slate-500" role="status">上位店舗を読み込んでいます…</p>
        <div v-else-if="resultsError" class="p-5">
          <UiCommonAlert tone="danger">{{ resultsError }}</UiCommonAlert>
        </div>
        <RankingCommonRankResultsTable v-else :results="results" :own-rank="selectedSnapshot.rank" />
        <p v-if="selectedSnapshot && selectedSnapshot.status === 'ok' && selectedSnapshot.rank === null" class="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          この日は自店が {{ RANK_RANGE }} 位以内に表示されませんでした。
        </p>
      </UiCommonCard>

      <UiCommonCard title="日別の順位" :description="`直近 ${period} 日`" is-flush>
        <div class="max-h-[28rem] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th scope="col" class="px-5 py-2.5 font-medium">計測日</th>
                <th scope="col" class="px-3 py-2.5 text-right font-medium">順位</th>
                <th scope="col" class="px-3 py-2.5 text-right font-medium">前日比</th>
                <th scope="col" class="px-5 py-2.5 font-medium">種別</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="row in tableRows"
                :key="row.snapshot.checkedOn"
                class="cursor-pointer hover:bg-slate-50"
                :class="row.snapshot.checkedOn === selectedSnapshot?.checkedOn ? 'bg-brand-50' : ''"
                @click="onSelectDay(row.snapshot.checkedOn)"
              >
                <th scope="row" class="px-5 py-2 text-left font-normal tabular-nums">
                  <button type="button" class="hover:underline" @click.stop="onSelectDay(row.snapshot.checkedOn)">
                    {{ formatDate(`${row.snapshot.checkedOn}T00:00:00`) }}
                  </button>
                </th>
                <td class="px-3 py-2 text-right font-medium tabular-nums" :class="row.snapshot.status === 'error' ? 'text-amber-700' : ''">{{ rankText(row.snapshot) }}</td>
                <td class="px-3 py-2 text-right"><RankingCommonRankDiff :diff="row.diff" label="前日比" /></td>
                <td class="px-5 py-2 text-xs text-slate-500">{{ row.snapshot.trigger === 'manual' ? '手動' : '定期' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCommonCard>
    </div>
  </div>
</template>
