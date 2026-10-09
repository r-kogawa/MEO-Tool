<template>
  <div class="flex min-h-screen flex-col">
    <header class="border-b border-slate-200">
      <div class="mx-auto flex h-14 max-w-5xl items-center px-4">
        <NuxtLink to="/"><UiCommonLogo /></NuxtLink>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <slot />
    </main>

    <footer class="border-t border-slate-200 py-4 text-center text-sm text-slate-500">
      &copy; MEO-Tool
    </footer>
  </div>
</template>
