<script setup lang="ts">
useSeoMeta({ title: 'デモ' })

const { isLoggedIn } = useAuth()
const isMock = useRuntimeConfig().public.useMock

const DEMO_SURVEYS = [
  { slug: 'k7m2q9x4pa', storeName: 'カフェ こもれび 下北沢', status: '公開中' },
  { slug: 'h3n8r2t6vb', storeName: '定食 ハナミ 渋谷店', status: '公開中' },
  { slug: 'h9p4w7c2zd', storeName: '定食 ハナミ 新宿店', status: '一時停止中' },
] as const
</script>

<template>
  <div class="space-y-8">
    <section class="rounded-2xl bg-brand-50 p-6 sm:p-8">
      <h1 class="text-2xl font-bold text-brand-700">MEO-Tool デモ</h1>
      <p class="mt-2 text-slate-600">
        口コミアンケートから Google 口コミ投稿を後押しし、検索順位を計測する管理ツールです。
      </p>
      <p v-if="isMock" class="mt-2 text-sm text-slate-500">
        Firebase 未接続のため、すべて仮の固定データで動作します。ページを再読み込みすると操作内容は初期状態に戻ります。
      </p>
      <div class="mt-5 flex flex-wrap gap-2">
        <UiCommonButton v-if="isLoggedIn" to="/orgs">管理画面へ</UiCommonButton>
        <UiCommonButton v-else to="/login">ログイン</UiCommonButton>
        <UiCommonButton v-if="!isLoggedIn" to="/signup" variant="secondary">新規登録</UiCommonButton>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">回答画面のデモ</h2>
      <p class="text-sm text-slate-500">来店客が QR コードから開く画面です。総合満足度が星 4 以上だと Google の口コミ投稿への案内画面に進みます。</p>
      <ul class="grid gap-3 sm:grid-cols-3">
        <li v-for="survey in DEMO_SURVEYS" :key="survey.slug">
          <NuxtLink
            :to="`/s/${survey.slug}`"
            class="block rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-500"
          >
            <p class="font-medium text-slate-900">{{ survey.storeName }}</p>
            <p class="mt-1 text-sm text-slate-500">{{ survey.status }}</p>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
