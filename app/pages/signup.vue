<script setup lang="ts">
import type { OrgType } from '~/types/domain'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: '新規登録', robots: 'noindex, nofollow' })

const { signup } = useAuth()
const { isPending, errorMessage, run } = useActionState()

const orgType = ref<OrgType>('individual')
const orgName = ref('')
const displayName = ref('')
const email = ref('')
const password = ref('')
const hasAgreed = ref(false)

const ORG_TYPE_CHOICES = [
  { value: 'individual', label: '個人', description: '個人事業主・1 店舗の運営向け。ご自身だけで利用します。' },
  { value: 'corporate', label: '法人', description: '複数店舗・複数担当者向け。メンバー招待と権限管理ができます。' },
] as const

const canSubmit = computed(() =>
  hasAgreed.value && orgName.value.trim() !== '' && displayName.value.trim() !== '' && email.value.trim() !== '' && password.value !== '')

async function onSubmit(): Promise<void> {
  const orgId = await run(() => signup({
    type: orgType.value,
    orgName: orgName.value,
    displayName: displayName.value,
    email: email.value,
    password: password.value,
  }))
  if (orgId) await navigateTo(`/admin/${orgId}`)
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <h1 class="text-xl font-bold text-slate-900">新規登録</h1>

    <fieldset class="space-y-2">
      <legend class="mb-2 text-sm font-medium text-slate-700">ご利用の形態</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="choice in ORG_TYPE_CHOICES"
          :key="choice.value"
          class="cursor-pointer rounded-lg border p-3 text-sm"
          :class="orgType === choice.value ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:bg-slate-50'"
        >
          <input v-model="orgType" type="radio" name="org-type" :value="choice.value" class="sr-only">
          <span class="block font-semibold text-slate-900">{{ choice.label }}</span>
          <span class="mt-1 block text-xs text-slate-500">{{ choice.description }}</span>
        </label>
      </div>
      <p class="text-xs text-slate-500">登録後の変更は運営へのお問い合わせが必要です。</p>
    </fieldset>

    <UiInputTextField
      v-model="orgName"
      :label="orgType === 'corporate' ? '法人名' : '屋号'"
      is-required
      :maxlength="100"
    />
    <UiInputTextField v-model="displayName" label="お名前" autocomplete="name" is-required :maxlength="50" />
    <UiInputTextField v-model="email" label="メールアドレス" type="email" autocomplete="email" is-required />
    <UiInputTextField v-model="password" label="パスワード" type="password" autocomplete="new-password" hint="8 文字以上" is-required />
    <UiInputCheckboxField v-model="hasAgreed" label="利用規約とプライバシーポリシーに同意する" />

    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <UiCommonButton type="submit" is-block :is-loading="isPending" :is-disabled="!canSubmit">登録する</UiCommonButton>

    <p class="text-center text-sm">
      アカウントをお持ちの方は <NuxtLink to="/login" class="text-brand-700 hover:underline">ログイン</NuxtLink>
    </p>
  </form>
</template>
