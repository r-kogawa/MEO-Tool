<script setup lang="ts">
const { user, logout } = useAuth()

async function onLogout(): Promise<void> {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <!-- 管理画面と見た目を分け、運営画面にいることを常に意識させる -->
  <div class="min-h-screen bg-slate-100">
    <header class="sticky top-0 z-30 bg-slate-900 text-white">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <NuxtLink to="/ops/organizations" class="font-bold">MEO-Tool</NuxtLink>
        <span class="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">運営</span>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <span class="hidden text-slate-300 sm:inline">{{ user?.displayName }}</span>
          <NuxtLink to="/orgs" class="text-slate-300 hover:text-white">組織選択</NuxtLink>
          <button type="button" class="text-slate-300 hover:text-white" @click="onLogout">ログアウト</button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
