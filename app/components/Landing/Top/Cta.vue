<script setup lang="ts">
const { isLoggedIn } = useAuth()
</script>

<template>
  <section class="px-4 pb-20 sm:px-6 sm:pb-24">
    <div v-reveal class="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-amber-400 via-brand-500 to-brand-700 px-6 py-14 text-center text-white sm:px-12 sm:py-20">
      <div class="pointer-events-none absolute -top-20 -right-20 size-72 rounded-full bg-white/10" aria-hidden="true" />
      <div class="pointer-events-none absolute -bottom-24 -left-16 size-64 rounded-full bg-white/10" aria-hidden="true" />
      <div class="relative space-y-6">
        <h2 class="text-2xl leading-snug font-bold sm:text-4xl sm:leading-snug">
          お客様の声を、次のお客様へ。<br>MEO 対策を今日から始めましょう。
        </h2>
        <p class="text-sm text-white/90 sm:text-base">登録はかんたん。数分で使い始められます。</p>
        <div class="flex flex-col justify-center gap-3 sm:flex-row">
          <NuxtLink
            :to="isLoggedIn ? '/orgs' : '/signup'"
            class="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-bold text-brand-700 shadow-lg transition hover:-translate-y-0.5"
          >
            {{ isLoggedIn ? '管理画面へ' : 'アカウント登録して始める' }}
            <UiCommonIcon name="chevron-right" size-class="size-5" />
          </NuxtLink>
          <NuxtLink v-if="!isLoggedIn" to="/login" class="inline-flex h-13 items-center justify-center rounded-full border border-white/60 px-8 text-base font-medium text-white transition hover:bg-white/10">
            ログイン
          </NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
