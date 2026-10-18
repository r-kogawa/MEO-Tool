<script setup lang="ts">
// 機能紹介の図版。画面のイメージを HTML で描く（文言・数値はすべてイメージ）
interface Props {
  type: 'survey' | 'profile' | 'ranking'
}

defineProps<Props>()

const RANK_BARS = [
  { day: '月', rank: 9 },
  { day: '火', rank: 8 },
  { day: '水', rank: 6 },
  { day: '木', rank: 6 },
  { day: '金', rank: 4 },
  { day: '土', rank: 3 },
  { day: '日', rank: 2 },
]
</script>

<template>
  <div class="relative rounded-3xl bg-gradient-to-br from-amber-100 via-brand-100 to-brand-200 p-6 sm:p-10">
    <!-- 口コミアンケート: QR → スマホの回答画面 -->
    <div v-if="type === 'survey'" class="flex items-center justify-center gap-5">
      <div class="hidden w-32 rounded-2xl bg-white p-4 text-center shadow-lg sm:block">
        <UiCommonIcon name="qr" size-class="mx-auto size-16 text-slate-800" />
        <p class="mt-2 text-[11px] font-bold text-slate-600">アンケートに<br>ご協力ください</p>
      </div>
      <UiCommonIcon name="chevron-right" size-class="hidden size-6 text-brand-500 sm:block" />
      <div class="w-56 rounded-[2rem] border-[6px] border-slate-800 bg-white p-4 shadow-2xl">
        <p class="text-xs font-bold text-slate-800">本日のご来店はいかがでしたか？</p>
        <p class="mt-3 flex justify-between text-amber-400">
          <UiCommonIcon v-for="n in 5" :key="n" name="star" size-class="size-6 fill-current" />
        </p>
        <div class="mt-4 space-y-2">
          <div class="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-700">接客が良かった</div>
          <div class="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600">料理・商品が良かった</div>
        </div>
        <span class="mt-4 flex items-center justify-center gap-1 rounded-full bg-brand-600 py-2 text-[11px] font-bold text-white">
          <UiCommonIcon name="google" size-class="size-3.5" />
          Google に口コミを書く
        </span>
      </div>
    </div>

    <!-- GBP 管理: 口コミと返信 -->
    <div v-else-if="type === 'profile'" class="mx-auto max-w-sm space-y-3">
      <div class="rounded-2xl bg-white p-4 shadow-lg">
        <div class="flex items-center gap-3">
          <span class="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UiCommonIcon name="user" /></span>
          <div>
            <p class="text-xs font-bold text-slate-800">お客様の口コミ</p>
            <p class="flex text-amber-400">
              <UiCommonIcon v-for="n in 5" :key="n" name="star" size-class="size-3.5 fill-current" />
            </p>
          </div>
          <span class="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">未返信</span>
        </div>
        <p class="mt-3 text-xs leading-relaxed text-slate-600">雰囲気が良く、ゆっくり過ごせました。また伺います！</p>
      </div>
      <div class="ml-8 rounded-2xl border-2 border-brand-300 bg-white p-4 shadow-lg">
        <p class="text-[11px] font-bold text-brand-700">返信テンプレートから入力</p>
        <p class="mt-2 text-xs leading-relaxed text-slate-600">嬉しいお言葉をありがとうございます。またのご来店を心よりお待ちしております。</p>
        <div class="mt-3 flex justify-end">
          <span class="rounded-full bg-brand-600 px-4 py-1.5 text-[11px] font-bold text-white">返信する</span>
        </div>
      </div>
      <div class="flex items-center gap-2 rounded-xl bg-white/70 px-4 py-2.5 text-[11px] font-medium text-slate-600">
        <UiCommonIcon name="refresh" size-class="size-4 text-brand-600" />
        毎朝 6:00 に口コミを自動同期
      </div>
    </div>

    <!-- 順位計測: 曜日ごとの順位 -->
    <div v-else class="mx-auto max-w-sm rounded-2xl bg-white p-5 shadow-lg">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-[11px] text-slate-500">キーワード</p>
          <p class="text-sm font-bold text-slate-800">地域名 + 業種</p>
        </div>
        <div class="text-right">
          <p class="text-[11px] text-slate-500">今日の順位</p>
          <p class="text-2xl font-bold text-brand-600">2<span class="text-sm">位</span></p>
        </div>
      </div>
      <div class="mt-5 flex h-36 items-end justify-between gap-2">
        <div v-for="bar in RANK_BARS" :key="bar.day" class="flex flex-1 flex-col items-center gap-1.5">
          <span class="text-[10px] font-bold text-slate-500">{{ bar.rank }}</span>
          <!-- 上位ほど棒を高くする -->
          <span class="w-full rounded-t-md bg-gradient-to-t from-brand-500 to-amber-300" :style="{ height: `${(11 - bar.rank) * 11}px` }" />
          <span class="text-[10px] text-slate-400">{{ bar.day }}</span>
        </div>
      </div>
      <p class="mt-4 flex items-center gap-1.5 text-[11px] text-slate-500">
        <UiCommonIcon name="map-pin" size-class="size-3.5 text-brand-600" />
        毎朝 4:00 に Google マップで自動計測
      </p>
    </div>
  </div>
</template>
