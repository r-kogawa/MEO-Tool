<script setup lang="ts">
const PROBLEMS = [
  { icon: 'star', title: '満足してくれたお客様が、口コミを書いてくれない', body: '「良かったよ」と言ってもらえても、Google に投稿されるのはほんの一部。声が埋もれてしまっています。' },
  { icon: 'store', title: 'プロフィールや返信の更新が、つい後回しに', body: '営業時間の変更、口コミへの返信、最新情報の投稿。店舗が増えるほど手が回らなくなります。' },
  { icon: 'ranking', title: 'マップで何位に出ているのか、分からない', body: '施策の効果を確かめたくても、毎日検索して順位をメモするのは現実的ではありません。' },
] as const
</script>

<template>
  <section class="bg-white py-20 sm:py-24">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <LandingTopSectionHeading eyebrow="Problems" title="こんなお悩み、ありませんか？" />
      <div class="mt-12 grid gap-5 md:grid-cols-3">
        <article
          v-for="(problem, index) in PROBLEMS"
          :key="problem.title"
          v-reveal="index * 120"
          class="rounded-2xl border border-slate-200 bg-slate-50/60 p-6"
        >
          <span class="flex size-11 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
            <UiCommonIcon :name="problem.icon" />
          </span>
          <h3 class="mt-5 text-base leading-snug font-bold text-slate-900">{{ problem.title }}</h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-600">{{ problem.body }}</p>
        </article>
      </div>
      <p v-reveal class="mt-12 text-center text-lg font-bold text-slate-900 sm:text-xl">
        その悩み、<span class="text-brand-600">MEOツール</span>がまとめて解決します。
      </p>
    </div>
  </section>
</template>
