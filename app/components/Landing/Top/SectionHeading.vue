<script setup lang="ts">
interface Props {
  /** 見出し上の英字ラベル */
  eyebrow: string
  title: string
  description?: string
}

withDefaults(defineProps<Props>(), { description: undefined })
</script>

<template>
  <div v-reveal class="mx-auto max-w-2xl space-y-4 text-center">
    <p class="text-xs font-bold tracking-[0.2em] text-brand-600 uppercase">{{ eyebrow }}</p>
    <h2 class="text-2xl leading-snug font-bold text-slate-900 sm:text-3xl">{{ title }}</h2>
    <p v-if="description" class="text-sm leading-relaxed text-slate-600 sm:text-base">{{ description }}</p>
  </div>
</template>
