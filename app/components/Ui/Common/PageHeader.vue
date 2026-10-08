<script setup lang="ts">
interface Props {
  title: string
  description?: string
  /** 一覧などへ戻るリンク */
  backTo?: string
  backLabel?: string
}

withDefaults(defineProps<Props>(), { description: undefined, backTo: undefined, backLabel: '戻る' })
</script>

<template>
  <div class="mb-6 space-y-2">
    <NuxtLink v-if="backTo" :to="backTo" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
      <UiCommonIcon name="chevron-left" size-class="size-4" />
      {{ backLabel }}
    </NuxtLink>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-bold text-slate-900 sm:text-2xl">{{ title }}</h1>
          <slot name="badge" />
        </div>
        <p v-if="description" class="text-sm text-slate-500">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
