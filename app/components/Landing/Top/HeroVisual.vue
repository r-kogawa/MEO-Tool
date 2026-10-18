<script setup lang="ts">
// ヒーローの図版。管理画面のイメージを HTML / SVG で描く（数値はすべてイメージ）
const KPIS = [
  { label: '平均評価', value: '4.6', icon: 'star' },
  { label: '今月の口コミ', value: '+38', icon: 'megaphone' },
  { label: 'マップ順位', value: '3位', icon: 'map-pin' },
] as const

// 順位の推移（小さいほど上位）。グラフでは上ほど上位に見えるよう y に変換する
const RANKS = [14, 12, 12, 9, 8, 6, 5, 5, 4, 3]
const points = RANKS.map((rank, index) => `${index * 32 + 8},${rank * 6 + 6}`).join(' ')
const areaPoints = `8,96 ${points} ${(RANKS.length - 1) * 32 + 8},96`
</script>

<template>
  <div class="relative mx-auto w-full max-w-lg">
    <!-- 管理画面のカード -->
    <div class="lp-float rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-brand-900/10">
      <div class="mb-4 flex items-center gap-1.5">
        <span class="size-2.5 rounded-full bg-rose-300" />
        <span class="size-2.5 rounded-full bg-amber-300" />
        <span class="size-2.5 rounded-full bg-emerald-300" />
        <span class="ml-3 text-xs font-medium text-slate-400">ダッシュボード</span>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div v-for="kpi in KPIS" :key="kpi.label" class="rounded-xl bg-brand-50 p-3">
          <UiCommonIcon :name="kpi.icon" size-class="size-4 text-brand-600" />
          <p class="mt-2 text-lg font-bold text-slate-900">{{ kpi.value }}</p>
          <p class="text-[11px] text-slate-500">{{ kpi.label }}</p>
        </div>
      </div>

      <div class="mt-4 rounded-xl border border-slate-100 p-3">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-bold text-slate-700">「地域名 + 業種」の順位推移</p>
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600">↑ 11位アップ</span>
        </div>
        <svg viewBox="0 0 304 100" class="h-28 w-full" aria-hidden="true">
          <defs>
            <linearGradient id="lp-rank-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="var(--color-brand-400)" stop-opacity="0.35" />
              <stop offset="100%" stop-color="var(--color-brand-400)" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="lp-rank-line" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="#fbbf24" />
              <stop offset="100%" stop-color="var(--color-brand-600)" />
            </linearGradient>
          </defs>
          <line v-for="y in [24, 48, 72]" :key="y" x1="0" x2="304" :y1="y" :y2="y" stroke="#f1f5f9" />
          <polygon :points="areaPoints" fill="url(#lp-rank-area)" />
          <polyline :points="points" fill="none" stroke="url(#lp-rank-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="296" cy="24" r="5" fill="white" stroke="var(--color-brand-600)" stroke-width="3" />
        </svg>
      </div>
    </div>

    <!-- 口コミの通知 -->
    <div class="absolute -bottom-8 -left-4 w-60 rounded-xl border border-slate-100 bg-white p-3 shadow-xl sm:-left-10">
      <div class="flex items-center gap-2">
        <span class="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-brand-600 text-xs font-bold text-white">新</span>
        <div>
          <p class="text-xs font-bold text-slate-800">新しい口コミが届きました</p>
          <p class="flex text-amber-400">
            <UiCommonIcon v-for="n in 5" :key="n" name="star" size-class="size-3 fill-current" />
          </p>
        </div>
      </div>
      <p class="mt-2 text-[11px] leading-relaxed text-slate-500">スタッフの対応が丁寧で、また来たいと思えるお店でした。</p>
    </div>

    <!-- アンケートのスマホ画面 -->
    <div class="absolute -top-6 -right-2 hidden w-36 rounded-2xl border-4 border-slate-800 bg-white p-3 shadow-xl sm:block lg:-right-8">
      <p class="text-[10px] font-bold text-slate-700">ご来店ありがとうございます</p>
      <p class="mt-1 text-[9px] text-slate-500">本日の満足度は？</p>
      <p class="mt-2 flex justify-between text-amber-400">
        <UiCommonIcon v-for="n in 5" :key="n" name="star" size-class="size-4 fill-current" />
      </p>
      <span class="mt-3 block rounded-full bg-brand-600 py-1 text-center text-[9px] font-bold text-white">口コミを書く</span>
    </div>
  </div>
</template>
