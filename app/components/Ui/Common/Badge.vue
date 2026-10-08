<script setup lang="ts">
export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

interface Props {
  tone?: BadgeTone
}

withDefaults(defineProps<Props>(), { tone: 'neutral' })

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-100 text-brand-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-rose-100 text-rose-800',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap" :class="TONE_CLASSES[tone]">
    <slot />
  </span>
</template>
