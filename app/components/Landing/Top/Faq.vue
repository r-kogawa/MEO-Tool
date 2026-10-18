<script setup lang="ts">
const FAQS = [
  { question: '1 店舗だけでも使えますか？', answer: 'はい。登録時に「個人」を選ぶと、1 店舗の運営向けにご自身だけで利用できます。' },
  { question: '複数の店舗やスタッフで使えますか？', answer: '「法人」で登録すると、複数店舗の管理とメンバーの招待ができます。メンバーごとに担当店舗を絞ることも可能です。' },
  { question: 'Google ビジネスプロフィールとはどう連携しますか？', answer: '管理画面の「Google 連携」から Google アカウントで承認すると、店舗のプロフィール・口コミ・投稿を取り込み、ツールから更新や返信ができるようになります。' },
  { question: 'アンケートの回答者はログインが必要ですか？', answer: '不要です。QR コードや URL から開いて、そのまま回答できます。' },
]
</script>

<template>
  <section id="faq" class="scroll-mt-16 bg-white py-20 sm:py-24">
    <div class="mx-auto max-w-3xl px-4 sm:px-6">
      <LandingTopSectionHeading eyebrow="FAQ" title="よくある質問" />
      <div class="mt-12 space-y-3">
        <details
          v-for="(faq, index) in FAQS"
          :key="faq.question"
          v-reveal="index * 80"
          class="group rounded-2xl border border-slate-200 bg-white px-5 open:border-brand-200 open:bg-brand-50/40"
        >
          <summary class="flex cursor-pointer list-none items-center gap-3 py-5 font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
            <span class="text-brand-600">Q.</span>
            <span class="flex-1">{{ faq.question }}</span>
            <UiCommonIcon name="chevron-down" size-class="size-5 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <p class="pb-5 pl-7 text-sm leading-relaxed text-slate-600">{{ faq.answer }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
