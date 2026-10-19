<script setup lang="ts">
// 利用規約。未ログインでも読めるよう LP のレイアウトを使う。検索結果に出すのは LP だけのため noindex
definePageMeta({ layout: 'landing' })
useSeoMeta({ title: '利用規約', robots: 'noindex, follow' })
</script>

<template>
  <LandingCommonLegalDocument
    title="利用規約"
    :articles="TERMS_ARTICLES"
    :enacted-on="TERMS_ENACTED_ON"
    :operator="TERMS_OPERATOR"
  />
</template>
