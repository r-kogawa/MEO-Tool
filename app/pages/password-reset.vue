<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'パスワード再設定', robots: 'noindex, nofollow' })

const { requestPasswordReset } = useAuth()
const { isPending, errorMessage, run } = useActionState()

const email = ref('')
const isSent = ref(false)

async function onSubmit(): Promise<void> {
  const isDone = await run(async () => {
    await requestPasswordReset(email.value)
    return true
  })
  if (isDone) isSent.value = true
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-bold text-slate-900">パスワード再設定</h1>

    <UiCommonAlert v-if="isSent" tone="success">
      入力されたメールアドレスが登録済みの場合、再設定用のメールを送信しました。
    </UiCommonAlert>

    <form v-else class="space-y-4" @submit.prevent="onSubmit">
      <p class="text-sm text-slate-600">登録済みのメールアドレスに、再設定用のリンクをお送りします。</p>
      <UiInputTextField v-model="email" label="メールアドレス" type="email" autocomplete="email" is-required />
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
      <UiCommonButton type="submit" is-block :is-loading="isPending" :is-disabled="email.trim() === ''">送信する</UiCommonButton>
    </form>

    <NuxtLink to="/login" class="block text-center text-sm text-brand-700 hover:underline">ログインに戻る</NuxtLink>
  </div>
</template>
