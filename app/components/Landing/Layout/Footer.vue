<script setup lang="ts">
const navItems = useLandingNav()
</script>

<template>
  <footer class="border-t border-slate-200 bg-slate-50">
    <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="space-y-2">
        <UiCommonLogo />
        <p class="text-xs text-slate-500">お店の「見つけてもらう」を、仕組みで増やす。</p>
      </div>
      <nav class="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
        <a v-for="item in navItems" :key="item.href" :href="item.href" class="hover:text-brand-600">{{ item.label }}</a>
        <NuxtLink to="/login" class="hover:text-brand-600">ログイン</NuxtLink>
        <NuxtLink to="/signup" class="hover:text-brand-600">アカウント登録</NuxtLink>
        <NuxtLink to="/terms" class="hover:text-brand-600">利用規約</NuxtLink>
      </nav>
    </div>
    <p class="border-t border-slate-200 py-4 text-center text-xs text-slate-400">&copy; MFF MEOツール</p>
  </footer>
</template>
