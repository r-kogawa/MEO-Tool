<script setup lang="ts">
interface Props {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: string
}

withDefaults(defineProps<Props>(), { tone: 'info', title: undefined })

const TONE_CLASSES = {
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
} as const
</script>

<template>
  <div class="flex gap-3 rounded-lg border p-4 text-sm" :class="TONE_CLASSES[tone]" :role="tone === 'danger' ? 'alert' : 'status'">
    <UiCommonIcon :name="tone === 'success' ? 'check' : 'alert'" size-class="mt-0.5 size-4 shrink-0" />
    <div class="min-w-0 flex-1 space-y-1">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div class="whitespace-pre-line"><slot /></div>
    </div>
  </div>
</template>
