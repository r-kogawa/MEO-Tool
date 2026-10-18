<script setup lang="ts">
const { isLoggedIn } = useAuth()

const HIGHLIGHTS = ['口コミアンケート', 'Google ビジネスプロフィール管理', 'マップ検索順位の計測']
</script>

<template>
  <section class="relative -mt-16 overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white pt-28 pb-20 sm:pt-36 sm:pb-28">
    <!-- 背景のぼかし。ロゴのグラデーション（黄 → 赤）を淡く敷く -->
    <div class="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-gradient-to-br from-amber-200 to-brand-300 opacity-40 blur-3xl" aria-hidden="true" />
    <div class="pointer-events-none absolute top-40 -left-32 size-80 rounded-full bg-brand-200 opacity-30 blur-3xl" aria-hidden="true" />

    <div class="relative mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
      <div class="space-y-7">
        <p v-reveal class="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-bold text-brand-700">
          <UiCommonIcon name="map-pin" size-class="size-4" />
          Google マップ集客（MEO）をひとつの画面で
        </p>
        <h1 v-reveal="100" class="text-[2rem] leading-tight font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-tight">
          お店の<br><span class="whitespace-nowrap"><span class="bg-gradient-to-r from-amber-500 via-brand-500 to-brand-700 bg-clip-text text-transparent">「見つけてもらう」</span>を、</span><br>仕組みで増やす。
        </h1>
        <p v-reveal="200" class="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
          来店したお客様の声を口コミにつなげ、Google ビジネスプロフィールを整え、マップでの検索順位を毎日チェック。
          MEO に必要な運用を、ひとつのツールでまとめて回せます。
        </p>

        <div v-reveal="300" class="flex flex-col gap-3 sm:flex-row">
          <NuxtLink
            :to="isLoggedIn ? '/orgs' : '/signup'"
            class="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-brand-600 px-8 text-base font-bold text-white shadow-lg shadow-brand-600/30 transition hover:-translate-y-0.5 hover:bg-brand-700"
          >
            {{ isLoggedIn ? '管理画面へ' : 'アカウント登録して始める' }}
            <UiCommonIcon name="chevron-right" size-class="size-5" />
          </NuxtLink>
          <a href="#features" class="inline-flex h-13 items-center justify-center rounded-full border border-slate-300 bg-white px-8 text-base font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700">
            機能を見る
          </a>
        </div>

        <ul v-reveal="400" class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
          <li v-for="item in HIGHLIGHTS" :key="item" class="inline-flex items-center gap-1.5">
            <UiCommonIcon name="check" size-class="size-4 text-brand-600" />
            {{ item }}
          </li>
        </ul>
      </div>

      <div v-reveal="200">
        <LandingTopHeroVisual />
      </div>
    </div>
  </section>
</template>
