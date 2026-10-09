<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'ログイン', robots: 'noindex, nofollow' })

const route = useRoute()
const { login } = useAuth()
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
        is-required
      />
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
      <UiCommonButton type="submit" is-block :is-loading="isPending">ログイン</UiCommonButton>
    </form>

    <div class="flex justify-between text-sm">
      <NuxtLink to="/password-reset" class="text-brand-700 hover:underline">パスワードを忘れた方</NuxtLink>
      <NuxtLink to="/signup" class="text-brand-700 hover:underline">新規登録</NuxtLink>
    </div>
  </div>
</template>
