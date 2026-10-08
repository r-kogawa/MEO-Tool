<script setup lang="ts">
const { primaryItems, groups, isActive } = useAdminNav()
const isSettingsOpen = ref(false)

const settingsItems = computed(() => groups.value.find(group => group.label === '設定')?.items ?? [])
const isSettingsActive = computed(() => settingsItems.value.some(item => isActive(item.to)))
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="管理メニュー">
    <div v-if="isSettingsOpen" class="border-b border-slate-100 p-2" @click="isSettingsOpen = false">
      <NuxtLink
        v-for="item in settingsItems"
        :key="item.to"
        :to="item.to"
        class="block rounded-lg px-4 py-2.5 text-sm"
        :class="isActive(item.to) ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700'"
      >
        {{ item.label }}
      </NuxtLink>
    </div>
    <div class="grid grid-cols-5">
      <NuxtLink
        v-for="item in primaryItems"
        :key="item.to"
        :to="item.to"
        class="flex flex-col items-center gap-0.5 py-2 text-[11px]"
        :class="isActive(item.to) ? 'text-brand-700' : 'text-slate-500'"
      >
        <UiCommonIcon :name="item.icon" />
        {{ item.shortLabel ?? item.label }}
      </NuxtLink>
      <button
        v-if="settingsItems.length > 0"
        type="button"
        class="flex flex-col items-center gap-0.5 py-2 text-[11px]"
        :class="isSettingsActive || isSettingsOpen ? 'text-brand-700' : 'text-slate-500'"
        :aria-expanded="isSettingsOpen"
        @click="isSettingsOpen = !isSettingsOpen"
      >
        <UiCommonIcon name="settings" />
        設定
      </button>
    </div>
  </nav>
</template>
