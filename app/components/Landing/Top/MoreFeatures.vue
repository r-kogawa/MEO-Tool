<script setup lang="ts">
const ITEMS = [
  { icon: 'store', title: '複数店舗をまとめて管理', body: '店舗ごとのアンケート・口コミ・順位を、ひとつの組織で切り替えながら確認できます。' },
  { icon: 'user', title: 'メンバー招待と権限', body: '法人アカウントではメンバーを招待し、担当店舗だけを見られるように設定できます。' },
  { icon: 'download', title: '回答データを CSV で', body: 'アンケートの回答は CSV で書き出し。社内の報告や分析にそのまま使えます。' },
  { icon: 'switch', title: '個人・法人どちらにも', body: '1 店舗を運営する個人事業主から、多店舗展開の法人まで規模に合わせて使えます。' },
] as const
</script>

<template>
  <section class="bg-white py-20 sm:py-24">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <LandingTopSectionHeading eyebrow="And more" title="店舗運営に寄り添う、便利な機能も" />
      <div class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <article
          v-for="(item, index) in ITEMS"
          :key="item.title"
          v-reveal="index * 100"
          class="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-900/5"
        >
          <span class="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
            <UiCommonIcon :name="item.icon" />
          </span>
          <h3 class="mt-5 font-bold text-slate-900">{{ item.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-slate-600">{{ item.body }}</p>
        </article>
      </div>
    </div>
  </section>
</template>
