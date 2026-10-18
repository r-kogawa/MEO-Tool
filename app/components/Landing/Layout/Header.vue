<script setup lang="ts">
const { isLoggedIn } = useAuth()
const navItems = useLandingNav()

// ヒーローの上では背景を透かし、スクロールしたら白地 + 影にする
const isScrolled = ref(false)
const isMenuOpen = ref(false)

function onScroll(): void {
  isScrolled.value = window.scrollY > 8
}

function onCloseMenu(): void {
  isMenuOpen.value = false
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header
    class="sticky top-0 z-40 transition-colors duration-300"
    :class="isScrolled || isMenuOpen ? 'bg-white/90 shadow-sm backdrop-blur' : 'bg-transparent'"
  >
    <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
      <NuxtLink to="/" aria-label="MEOツール トップ"><UiCommonLogo /></NuxtLink>

      <nav class="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
        <a v-for="item in navItems" :key="item.href" :href="item.href" class="transition-colors hover:text-brand-600">{{ item.label }}</a>
      </nav>

      <div class="ml-auto hidden items-center gap-2 sm:flex">
        <template v-if="isLoggedIn">
          <NuxtLink to="/orgs" class="inline-flex h-10 items-center rounded-full bg-brand-600 px-5 text-sm font-bold text-white shadow-sm shadow-brand-600/30 transition hover:bg-brand-700">
            管理画面へ
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-slate-700 transition-colors hover:text-brand-600">
            ログイン
          </NuxtLink>
          <NuxtLink to="/signup" class="inline-flex h-10 items-center rounded-full bg-brand-600 px-5 text-sm font-bold text-white shadow-sm shadow-brand-600/30 transition hover:-translate-y-0.5 hover:bg-brand-700">
            アカウント登録
          </NuxtLink>
        </template>
      </div>

      <button
        type="button"
        class="ml-auto inline-flex size-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 sm:hidden"
        :aria-expanded="isMenuOpen"
        aria-label="メニュー"
        @click="isMenuOpen = !isMenuOpen"
      >
        <UiCommonIcon :name="isMenuOpen ? 'x' : 'menu'" />
      </button>
    </div>

    <!-- スマホ用メニュー。ヘッダー直下に重ねて表示し、ページの位置は動かさない -->
    <div v-if="isMenuOpen" class="absolute inset-x-0 top-full border-t border-slate-100 bg-white px-4 pt-2 pb-5 shadow-lg sm:hidden">
      <nav class="flex flex-col text-sm font-medium text-slate-700">
        <a v-for="item in navItems" :key="item.href" :href="item.href" class="py-3" @click="onCloseMenu">{{ item.label }}</a>
      </nav>
      <div class="mt-3 grid gap-2">
        <NuxtLink v-if="isLoggedIn" to="/orgs" class="inline-flex h-11 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">管理画面へ</NuxtLink>
        <template v-else>
          <NuxtLink to="/signup" class="inline-flex h-11 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">アカウント登録</NuxtLink>
          <NuxtLink to="/login" class="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 text-sm font-medium text-slate-700">ログイン</NuxtLink>
        </template>
      </div>
    </div>
  </header>
</template>
