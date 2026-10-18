<script setup lang="ts">
// 管理画面はすべてログインが必要なため、検索結果に出さない（ページを足しても漏れないようレイアウトでまとめて指定する）
useSeoMeta({ robots: 'noindex, nofollow' })
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <AdminLayoutHeader />
    <div class="flex">
      <AdminLayoutSideNav />
      <main class="min-w-0 flex-1 px-4 pt-6 pb-28 lg:px-8 lg:pb-12">
        <div class="mx-auto max-w-6xl">
          <slot />
        </div>
      </main>
    </div>
    <AdminLayoutBottomTab />
  </div>
</template>
