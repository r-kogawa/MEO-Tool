<script setup lang="ts">
import type { IconName } from '~/components/Ui/Common/Icon.vue'

type FeatureVisual = 'survey' | 'profile' | 'ranking'

interface Feature {
  visual: FeatureVisual
  icon: IconName
  label: string
  title: string
  body: string
  points: string[]
}

const FEATURES: Feature[] = [
  {
    visual: 'survey',
    icon: 'survey',
    label: '口コミアンケート',
    title: 'お客様の「良かった」を、\nGoogle の口コミにつなげる',
    body: '店頭の QR コードから答えられるアンケートを作成。回答のあとに Google の口コミ投稿画面へスムーズにご案内し、投稿のひと手間を減らします。',
    points: ['QR コードを置くだけで回答を受付', '店舗ごとにアンケートを作成・公開', '回答は一覧と CSV で確認'],
  },
  {
    visual: 'profile',
    icon: 'google',
    label: 'Google ビジネスプロフィール管理',
    title: 'プロフィール・口コミ返信・投稿を\nひとつの画面で',
    body: 'Google と連携して、店舗情報の更新、口コミへの返信、最新情報の投稿をまとめて管理。口コミは毎朝自動で取り込まれるので、見落としを防げます。',
    points: ['口コミを毎朝自動で同期', '返信テンプレートで素早く返信', '画像付きの投稿にも対応'],
  },
  {
    visual: 'ranking',
    icon: 'ranking',
    label: 'マップ検索順位の計測',
    title: '狙ったキーワードの順位を、\n毎朝自動でチェック',
    body: '「地域名 + 業種」などのキーワードを登録しておけば、Google マップでの順位を毎朝計測。推移をグラフで確認でき、施策の手応えが見えるようになります。',
    points: ['キーワードを登録するだけで毎日計測', '順位の推移をグラフで可視化', '気になる地点でその場で計測'],
  },
]
</script>

<template>
  <section id="features" class="scroll-mt-16 bg-gradient-to-b from-white via-brand-50/50 to-white py-20 sm:py-28">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <LandingTopSectionHeading
        eyebrow="Features"
        title="MEO に必要な 3 つの運用を、これひとつで"
        description="口コミを集める、プロフィールを整える、効果を測る。バラバラだった作業をひとつのツールにまとめました。"
      />

      <div class="mt-16 space-y-20 sm:space-y-28">
        <div
          v-for="(feature, index) in FEATURES"
          :key="feature.visual"
          class="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
        >
          <div v-reveal class="space-y-5" :class="{ 'lg:order-2': index % 2 === 1 }">
            <p class="inline-flex items-center gap-2 text-sm font-bold text-brand-600">
              <span class="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-brand-600 text-white">
                <UiCommonIcon :name="feature.icon" size-class="size-4" />
              </span>
              {{ feature.label }}
            </p>
            <h3 class="text-2xl leading-snug font-bold whitespace-pre-line text-slate-900">{{ feature.title }}</h3>
            <p class="leading-relaxed text-slate-600">{{ feature.body }}</p>
            <ul class="space-y-2.5">
              <li v-for="point in feature.points" :key="point" class="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                <span class="flex size-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <UiCommonIcon name="check" size-class="size-3" />
                </span>
                {{ point }}
              </li>
            </ul>
          </div>

          <div v-reveal="150" :class="{ 'lg:order-1': index % 2 === 1 }">
            <LandingTopFeatureVisual :type="feature.visual" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
