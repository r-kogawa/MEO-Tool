<template>
  <div class="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10 sm:justify-center">
    <NuxtLink to="/" class="mb-6"><UiCommonLogo size="lg" /></NuxtLink>
    <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <slot />
    </div>
  </div>
</template>
