<script setup lang="ts">
// 集客ページ（LP）。ログイン済みでも表示し、ヘッダーと CTA から管理画面へ進めるようにする
// 共通の OGP（画像・説明）は nuxt.config.ts の app.head。ここでは LP 固有の値だけを足す
definePageMeta({ layout: 'landing' })

const { siteUrl } = useRuntimeConfig().public
const pageUrl = siteUrl ? `${siteUrl}/` : undefined

useSeoMeta({
  title: 'Google マップ集客をひとつの画面で',
  description: '口コミアンケート、Google ビジネスプロフィールの管理、マップ検索順位の計測をまとめて行える MEO ツール。お店の「見つけてもらう」を仕組みで増やします。',
  ogUrl: pageUrl,
})
useHead({
  link: pageUrl ? [{ rel: 'canonical', href: pageUrl }] : [],
})
</script>

<template>
  <div>
    <LandingTopHero />
    <LandingTopProblems />
    <LandingTopFeatures />
    <LandingTopMoreFeatures />
    <LandingTopSteps />
    <LandingTopFaq />
    <LandingTopCta />
  </div>
</template>
