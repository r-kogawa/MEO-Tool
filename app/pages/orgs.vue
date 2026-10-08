<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: '組織を選択', robots: 'noindex, nofollow' })

const { user, logout } = useAuth()
const myOrgs = useMyOrganizations()

// 本物モードでは所属組織の初回読み込みを待ってから判定する（ログイン直後は空のため）
await useBackendReady().waitForOrgs()

// Google 連携のコールバックで組織が特定できなかったとき（state の期限切れなど）はここに戻る
const route = useRoute()
const googleError = typeof route.query.googleError === 'string'
  ? GOOGLE_CALLBACK_ERRORS[route.query.googleError] ?? GOOGLE_CALLBACK_ERRORS.exchange_failed!
  : null

// 所属が 1 組織だけなら選ぶ手間を省く（運営は運営画面への導線を見せるため自動遷移しない。連携エラーの表示中も止める）
if (myOrgs.value.length === 1 && !user.value?.isOperator && !googleError) {
  await navigateTo(`/admin/${myOrgs.value[0]!.org.id}`, { replace: true })
}

async function onLogout(): Promise<void> {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-1">
      <h1 class="text-xl font-bold text-slate-900">組織を選択</h1>
      <p class="text-sm text-slate-500">{{ user?.displayName }}（{{ user?.email }}）</p>
    </div>

    <UiCommonAlert v-if="googleError" tone="danger" title="Google 連携">{{ googleError }}</UiCommonAlert>

    <NuxtLink
      v-if="user?.isOperator"
      to="/ops/organizations"
      class="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
    >
      運営管理画面を開く
      <UiCommonIcon name="chevron-right" size-class="size-4" />
    </NuxtLink>

    <ul v-if="myOrgs.length > 0" class="space-y-2">
      <li v-for="{ org, member } in myOrgs" :key="org.id">
        <NuxtLink
          :to="`/admin/${org.id}`"
          class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 hover:border-brand-500 hover:bg-brand-50"
        >
          <span class="min-w-0 space-y-1">
            <span class="block truncate font-medium text-slate-900">{{ org.name }}</span>
            <span class="flex flex-wrap items-center gap-1.5">
              <UiCommonBadge :tone="org.type === 'corporate' ? 'brand' : 'neutral'">{{ ORG_TYPE_LABELS[org.type] }}</UiCommonBadge>
              <UiCommonBadge>{{ ROLE_LABELS[member.role] }}</UiCommonBadge>
              <UiCommonBadge v-if="org.status === 'suspended'" tone="danger">利用停止中</UiCommonBadge>
            </span>
          </span>
          <UiCommonIcon name="chevron-right" size-class="size-4 shrink-0 text-slate-400" />
        </NuxtLink>
      </li>
    </ul>
    <UiCommonAlert v-else-if="!user?.isOperator" tone="info">
      所属している組織がありません。招待メールのリンクから参加するか、新規登録してください。
    </UiCommonAlert>

    <button type="button" class="block w-full text-center text-sm text-slate-500 hover:underline" @click="onLogout">ログアウト</button>
  </div>
</template>
