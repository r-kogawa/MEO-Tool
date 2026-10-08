<script setup lang="ts">
import type { RankResult } from '~/types/domain'

// 計測結果の 1〜20 位（競合一覧）。推移画面とその場計測で使う

interface Props {
  results: RankResult[]
  /** 自店の順位（強調表示する）。圏外・店舗指定なしは null */
  ownRank?: number | null
}

withDefaults(defineProps<Props>(), { ownRank: null })

function ratingText(result: RankResult): string {
  return result.rating === null ? '—' : `★${result.rating.toFixed(1)}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[520px] text-sm">
      <thead class="bg-slate-50 text-left text-xs text-slate-500">
        <tr>
          <th scope="col" class="w-14 px-4 py-2.5 text-right font-medium">順位</th>
          <th scope="col" class="px-3 py-2.5 font-medium">ビジネス名</th>
          <th scope="col" class="px-3 py-2.5 font-medium">カテゴリ</th>
          <th scope="col" class="px-3 py-2.5 text-right font-medium">評価</th>
          <th scope="col" class="px-4 py-2.5 text-right font-medium">口コミ数</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        <tr v-for="result in results" :key="result.rank" :class="result.rank === ownRank ? 'bg-brand-50' : ''">
          <td class="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-500">{{ result.rank }}</td>
          <th scope="row" class="px-3 py-2.5 text-left font-normal">
            <span class="flex items-center gap-2">
              <span class="min-w-0 truncate" :class="result.rank === ownRank ? 'font-semibold text-brand-800' : 'text-slate-800'">{{ result.name }}</span>
              <UiCommonBadge v-if="result.rank === ownRank" tone="brand">自店</UiCommonBadge>
            </span>
          </th>
          <td class="px-3 py-2.5 text-xs text-slate-500">{{ result.category ?? '—' }}</td>
          <td class="px-3 py-2.5 text-right tabular-nums text-slate-700">{{ ratingText(result) }}</td>
          <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ result.reviewCount === null ? '—' : `${result.reviewCount.toLocaleString('ja-JP')}件` }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
