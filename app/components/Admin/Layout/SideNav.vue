<script setup lang="ts">
const { groups, isActive } = useAdminNav()
</script>

<template>
  <nav class="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block" aria-label="管理メニュー">
    <div class="sticky top-14 space-y-6 p-4">
      <div v-for="group in groups" :key="group.label" class="space-y-1">
        <p class="px-3 text-xs font-medium tracking-wide text-slate-400">{{ group.label }}</p>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm"
          :class="isActive(item.to) ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          <UiCommonIcon :name="item.icon" size-class="size-4.5" />
          {{ item.label }}
          <span v-if="item.isGoogleUnlinked" class="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">未連携</span>
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
