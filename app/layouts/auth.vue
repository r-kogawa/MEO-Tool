<script setup lang="ts">
const isMock = useRuntimeConfig().public.useMock
</script>

<template>
  <div class="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10 sm:justify-center">
    <NuxtLink to="/" class="mb-6 text-xl font-bold text-brand-700">MEO-Tool</NuxtLink>
    <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <slot />
    </div>
    <p v-if="isMock" class="mt-6 text-xs text-slate-400">デモ版: Firebase 未接続のため仮データで動作しています</p>
  </div>
</template>
