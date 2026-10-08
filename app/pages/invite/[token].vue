<script setup lang="ts">
import type { InvitationStatus } from '~/types/domain'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: '招待', robots: 'noindex, nofollow' })

const route = useRoute()
const token = String(route.params.token)
const { invitation, lookupError, org, storeNames, isLoading, accept } = useInvitation(token)
const { user, isLoggedIn, logout, registerUser } = useAuth()
const { isPending, errorMessage, run } = useActionState()

const status = computed<InvitationStatus | null>(() => (invitation.value ? invitationStatusOf(invitation.value) : null))
const isEmailMismatch = computed(() => isLoggedIn.value && invitation.value !== null && user.value?.email !== invitation.value.email)

const STATUS_MESSAGES: Record<Exclude<InvitationStatus, 'pending'>, string> = {
  accepted: 'この招待はすでに受諾されています。',
  revoked: 'この招待は取り消されました。招待した方にお問い合わせください。',
  expired: 'この招待は有効期限が切れています。招待した方に再送を依頼してください。',
}

const displayName = ref('')
const password = ref('')

async function onAccept(): Promise<void> {
  const orgId = await run(accept)
  if (orgId) await navigateTo(`/admin/${orgId}`)
}

async function onRegisterAndAccept(): Promise<void> {
  const orgId = await run(async () => {
    await registerUser({ displayName: displayName.value, email: invitation.value!.email, password: password.value })
    return accept()
  })
  if (orgId) await navigateTo(`/admin/${orgId}`)
}

async function onSwitchAccount(): Promise<void> {
  await logout()
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-bold text-slate-900">組織への招待</h1>

    <p v-if="isLoading" class="text-sm text-slate-500">招待を確認しています…</p>
    <UiCommonAlert v-else-if="lookupError || !invitation" tone="danger">{{ lookupError ?? '招待が見つかりません。' }}</UiCommonAlert>

    <template v-else>
      <dl class="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-slate-500">組織</dt>
          <dd class="font-medium text-slate-900">{{ org?.name }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-slate-500">ロール</dt>
          <dd>{{ ROLE_LABELS[invitation.role] }}</dd>
        </div>
        <div v-if="storeNames.length > 0" class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-slate-500">担当店舗</dt>
          <dd class="text-right">{{ storeNames.join('、') }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-slate-500">招待先</dt>
          <dd>{{ invitation.email }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-slate-500">有効期限</dt>
          <dd>{{ formatDateTime(invitation.expiresAt) }}</dd>
        </div>
      </dl>

      <UiCommonAlert v-if="status && status !== 'pending'" tone="warning">{{ STATUS_MESSAGES[status] }}</UiCommonAlert>

      <template v-else-if="isLoggedIn">
        <UiCommonAlert v-if="isEmailMismatch" tone="warning">
          現在 {{ user?.email }} でログインしています。招待されたメールアドレス（{{ invitation.email }}）でログインし直してください。
        </UiCommonAlert>
        <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
        <UiCommonButton v-if="isEmailMismatch" variant="secondary" is-block @click="onSwitchAccount">別のアカウントでログインする</UiCommonButton>
        <UiCommonButton v-else is-block :is-loading="isPending" @click="onAccept">招待を受諾して参加する</UiCommonButton>
      </template>

      <template v-else>
        <p class="text-sm text-slate-600">
          すでにアカウントをお持ちの方は、招待先のメールアドレスでログインしてください。
        </p>
        <UiCommonButton :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`" variant="secondary" is-block>ログインして参加する</UiCommonButton>

        <form class="space-y-4 border-t border-slate-200 pt-5" @submit.prevent="onRegisterAndAccept">
          <h2 class="text-sm font-semibold text-slate-700">はじめての方: アカウントを作成して参加</h2>
          <UiInputTextField :model-value="invitation.email" label="メールアドレス" type="email" is-disabled />
          <UiInputTextField v-model="displayName" label="お名前" autocomplete="name" is-required :maxlength="50" />
          <UiInputTextField v-model="password" label="パスワード" type="password" autocomplete="new-password" hint="8 文字以上" is-required />
          <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
          <UiCommonButton
            type="submit"
            is-block
            :is-loading="isPending"
            :is-disabled="displayName.trim() === '' || password === ''"
          >
            アカウントを作成して参加する
          </UiCommonButton>
        </form>
      </template>
    </template>
  </div>
</template>
