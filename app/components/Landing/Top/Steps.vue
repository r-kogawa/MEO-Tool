<script setup lang="ts">
const STEPS = [
  { title: 'アカウント登録', body: '組織名とメールアドレスを入力するだけ。個人・法人を選んで登録します。' },
  { title: 'Google と連携', body: 'Google ビジネスプロフィールと連携し、店舗の情報や口コミを取り込みます。' },
  { title: 'アンケートと計測を開始', body: 'アンケートを公開して QR コードを店頭に。順位を見たいキーワードも登録します。' },
]
</script>

<template>
  <section id="steps" class="scroll-mt-16 bg-slate-50 py-20 sm:py-24">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <LandingTopSectionHeading eyebrow="How to start" title="かんたん 3 ステップで、すぐに始められます" />
      <ol class="relative mt-14 grid gap-6 md:grid-cols-3">
        <!-- ステップをつなぐ線（PC のみ） -->
        <span class="absolute top-7 right-[16%] left-[16%] hidden h-0.5 bg-gradient-to-r from-amber-300 via-brand-400 to-brand-600 md:block" aria-hidden="true" />
        <li
          v-for="(step, index) in STEPS"
          :key="step.title"
          v-reveal="index * 150"
          class="relative text-center"
        >
          <span class="relative mx-auto flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/30 ring-8 ring-slate-50">
            {{ index + 1 }}
          </span>
          <h3 class="mt-5 text-lg font-bold text-slate-900">{{ step.title }}</h3>
          <p class="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-600">{{ step.body }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
