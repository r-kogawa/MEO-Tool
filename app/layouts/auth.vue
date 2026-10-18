<template>
  <div class="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10 sm:justify-center">
    <NuxtLink to="/" class="mb-6"><UiCommonLogo size="lg" /></NuxtLink>
    <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <slot />
    </div>
    <!-- 新規登録・招待の入力途中でも内容を失わないよう別タブで開く -->
    <NuxtLink to="/terms" target="_blank" rel="noopener" class="mt-6 text-xs text-slate-500 hover:text-brand-600">利用規約</NuxtLink>
  </div>
</template>
