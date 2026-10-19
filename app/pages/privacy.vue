<script setup lang="ts">
// プライバシーポリシー。未ログインでも読めるよう LP のレイアウトを使う。検索結果に出すのは LP だけのため noindex
definePageMeta({ layout: 'landing' })
useSeoMeta({ title: 'プライバシーポリシー', robots: 'noindex, follow' })
</script>

<template>
  <LandingCommonLegalDocument
    title="プライバシーポリシー"
    :articles="PRIVACY_ARTICLES"
    :enacted-on="PRIVACY_ENACTED_ON"
    :operator="TERMS_OPERATOR"
  />
</template>
