<script setup lang="ts">
const { org, role, adminPath } = useCurrentOrg()
const { user, logout } = useAuth()
const myOrgs = useMyOrganizations()
const isMenuOpen = ref(false)

const hasOtherOrgs = computed(() => myOrgs.value.length > 1)

async function onLogout(): Promise<void> {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-slate-200 bg-white">
    <div class="flex h-14 items-center gap-3 px-4 lg:px-6">
      <NuxtLink :to="adminPath()" class="shrink-0 font-bold whitespace-nowrap text-brand-700">MEO-Tool</NuxtLink>
      <span class="text-slate-300" aria-hidden="true">/</span>
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-medium text-slate-800">{{ org?.name }}</span>
        <UiCommonBadge v-if="org" :tone="org.type === 'corporate' ? 'brand' : 'neutral'">
          {{ ORG_TYPE_LABELS[org.type] }}
        </UiCommonBadge>
        <NuxtLink
          v-if="hasOtherOrgs"
          to="/orgs"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          <UiCommonIcon name="switch" size-class="size-3.5" />
          <span class="hidden sm:inline">組織を切替</span>
        </NuxtLink>
      </div>

      <div class="relative ml-auto">
        <button
          type="button"
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100"
          :aria-expanded="isMenuOpen"
          @click="isMenuOpen = !isMenuOpen"
        >
          <span class="flex size-7 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <UiCommonIcon name="user" size-class="size-4" />
          </span>
          <span class="hidden text-left sm:block">
            <span class="block leading-tight">{{ user?.displayName }}</span>
            <span v-if="role" class="block text-xs leading-tight text-slate-500">{{ ROLE_LABELS[role] }}</span>
          </span>
          <UiCommonIcon name="chevron-down" size-class="size-4 text-slate-400" />
        </button>
        <div
          v-if="isMenuOpen"
          class="absolute right-0 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          @click="isMenuOpen = false"
        >
          <p class="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{{ user?.email }}</p>
          <NuxtLink v-if="hasOtherOrgs" to="/orgs" class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50">
            <UiCommonIcon name="switch" size-class="size-4" />組織を切り替える
          </NuxtLink>
          <NuxtLink v-if="user?.isOperator" to="/ops/organizations" class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50">
            <UiCommonIcon name="settings" size-class="size-4" />運営管理画面
          </NuxtLink>
          <button type="button" class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-rose-700 hover:bg-rose-50" @click="onLogout">
            <UiCommonIcon name="logout" size-class="size-4" />ログアウト
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
