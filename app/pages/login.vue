<script setup lang="ts">
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '~/utils/mock/seed'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'ログイン', robots: 'noindex, nofollow' })

const route = useRoute()
const isMock = useRuntimeConfig().public.useMock
const { login, loginAs } = useAuth()
const { isPending, errorMessage, run } = useActionState()

const email = ref('')
const password = ref('')

/** 外部 URL へのリダイレクトを防ぐため、サイト内パスだけ受け付ける */
const redirectPath = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/orgs'
})

async function onSubmit(): Promise<void> {
  const isDone = await run(async () => {
    await login(email.value, password.value)
    return true
  })
  if (isDone) await navigateTo(redirectPath.value)
}

async function onLoginAs(uid: string): Promise<void> {
  loginAs(uid)
  await navigateTo(redirectPath.value)
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-slate-900">ログイン</h1>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <UiInputTextField v-model="email" label="メールアドレス" type="email" autocomplete="email" is-required />
      <UiInputTextField
        v-model="password"
        label="パスワード"
        type="password"
        autocomplete="current-password"
        :hint="isMock ? `デモのパスワードは「${DEMO_PASSWORD}」です` : undefined"
        is-required
      />
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
      <UiCommonButton type="submit" is-block :is-loading="isPending">ログイン</UiCommonButton>
    </form>

    <div class="flex justify-between text-sm">
      <NuxtLink to="/password-reset" class="text-brand-700 hover:underline">パスワードを忘れた方</NuxtLink>
      <NuxtLink to="/signup" class="text-brand-700 hover:underline">新規登録</NuxtLink>
    </div>

    <section v-if="isMock" class="space-y-3 border-t border-slate-200 pt-5">
      <h2 class="text-sm font-semibold text-slate-700">デモアカウントでログイン</h2>
      <p class="text-xs text-slate-500">ロールや組織種別による画面の出しわけを確認できます。</p>
      <div class="grid gap-2">
        <button
          v-for="account in DEMO_ACCOUNTS"
          :key="account.uid"
          type="button"
          class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left text-sm hover:border-brand-500 hover:bg-brand-50"
          @click="onLoginAs(account.uid)"
        >
          <span>
            <span class="block font-medium text-slate-900">{{ account.label }}</span>
            <span class="block text-xs text-slate-500">{{ account.description }}</span>
          </span>
          <UiCommonIcon name="chevron-right" size-class="size-4 text-slate-400" />
        </button>
      </div>
    </section>
  </div>
</template>
