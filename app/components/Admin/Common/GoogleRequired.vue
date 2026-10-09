<script setup lang="ts">
// Google ビジネスプロフィールのデータを使う画面の中身を包む。Google と未連携なら中身の代わりに連携の警告を出す。
// 警告の文言はダッシュボードの Google 連携の警告とそろえる。

const { isWaitingForGoogle } = useGoogleRequired()
const { hasError } = useGoogleConnection()
const { adminPath } = useCurrentOrg()
</script>

<template>
  <template v-if="isWaitingForGoogle">
    <UiCommonAlert v-if="hasError" tone="danger" title="Google 連携でエラーが発生しています">
      再認証が必要です。
      <NuxtLink :to="adminPath('/settings/google')" class="font-medium underline">Google 連携を確認する</NuxtLink>
    </UiCommonAlert>
    <UiCommonAlert v-else tone="warning" title="Google ビジネスプロフィールと未連携です">
      この画面の利用には連携が必要です。
      <NuxtLink :to="adminPath('/settings/google')" class="font-medium underline">Google と連携する</NuxtLink>
    </UiCommonAlert>
  </template>
  <slot v-else />
</template>
