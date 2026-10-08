<script setup lang="ts">
// タイトル未設定のページで「 | MEO-Tool」とならないよう、関数で組み立てる
useHead({
  titleTemplate: title => (title ? `${title} | MEO-Tool` : 'MEO-Tool'),
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UiCommonToastHost />
</template>
