<script setup lang="ts">
// パスワード設定リンク（/password-setup?oobCode=...）から開く。外部 API でアカウントを作った人の初回設定に使う
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'パスワード設定', robots: 'noindex, nofollow' })

const route = useRoute()
const { verifyPasswordSetupCode, setupPassword } = useAuth()
const { isPending, errorMessage, run } = useActionState()

const oobCode = typeof route.query.oobCode === 'string' ? route.query.oobCode : ''
const email = ref<string | null>(null)
const linkError = ref<string | null>(null)
const isVerifying = ref(true)

const password = ref('')
const passwordConfirm = ref('')

const confirmError = computed(() =>
  passwordConfirm.value !== '' && password.value !== passwordConfirm.value ? 'パスワードが一致しません。' : null)
const canSubmit = computed(() => password.value !== '' && password.value === passwordConfirm.value)

onMounted(async () => {
  try {
    if (!oobCode) throw new Error('リンクが正しくありません。メールに記載された URL をそのまま開いてください。')
    email.value = await verifyPasswordSetupCode(oobCode)
  }
  catch (error) {
    linkError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    isVerifying.value = false
  }
})

async function onSubmit(): Promise<void> {
  if (!email.value) return
  const isDone = await run(async () => {
    await setupPassword(oobCode, email.value!, password.value)
    return true
  })
  if (isDone) await navigateTo('/orgs', { replace: true })
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-bold text-slate-900">パスワード設定</h1>

    <p v-if="isVerifying" class="text-sm text-slate-500">リンクを確認しています…</p>

    <template v-else-if="linkError">
      <UiCommonAlert tone="danger">{{ linkError }}</UiCommonAlert>
      <UiCommonButton to="/password-reset" variant="secondary" is-block>パスワード再設定へ</UiCommonButton>
    </template>

    <form v-else class="space-y-4" @submit.prevent="onSubmit">
      <p class="text-sm text-slate-600">
        <span class="font-medium text-slate-900">{{ email }}</span> でログインするためのパスワードを設定してください。
      </p>
      <UiInputTextField
        v-model="password"
        label="新しいパスワード"
        type="password"
        autocomplete="new-password"
        hint="8 文字以上"
        is-required
      />
      <UiInputTextField
        v-model="passwordConfirm"
        label="新しいパスワード（確認）"
        type="password"
        autocomplete="new-password"
        :error="confirmError"
        is-required
      />
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
      <UiCommonButton type="submit" is-block :is-loading="isPending" :is-disabled="!canSubmit">設定してログイン</UiCommonButton>
    </form>

    <NuxtLink to="/login" class="block text-center text-sm text-brand-700 hover:underline">ログインに戻る</NuxtLink>
  </div>
</template>
