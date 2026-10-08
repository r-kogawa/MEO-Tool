<script setup lang="ts">
// 本物モードで未接続の管理画面を開いたときの移動先（org-ready.global.ts）

definePageMeta({ layout: 'admin' })
useHead({ title: '準備中' })

const { adminPath, isOwner, canManageMembers } = useCurrentOrg()
</script>

<template>
  <section class="mx-auto max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-8 text-center">
    <h1 class="text-lg font-bold text-slate-900">準備中</h1>
    <p class="text-sm text-slate-600">この画面は現在 Firebase との接続を準備しています。公開までしばらくお待ちください。</p>
    <div class="flex flex-wrap justify-center gap-2">
      <UiCommonButton v-if="isOwner" variant="secondary" size="sm" :to="adminPath('/settings/organization')">組織設定</UiCommonButton>
      <UiCommonButton v-if="canManageMembers" variant="secondary" size="sm" :to="adminPath('/settings/members')">メンバー</UiCommonButton>
    </div>
  </section>
</template>
