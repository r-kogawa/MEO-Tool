<script setup lang="ts">
interface Props {
  title?: string
  description?: string
  /** 本文の余白をなくす（表を端まで広げるとき） */
  isFlush?: boolean
}

withDefaults(defineProps<Props>(), { title: undefined, description: undefined, isFlush: false })
</script>

<template>
  <!-- min-w-0: grid / flex の子になったとき、横長の表でカードごと画面幅を超えないようにする -->
  <section class="min-w-0 rounded-xl border border-slate-200 bg-white">
    <header v-if="title || $slots.actions" class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-4">
      <div class="space-y-0.5">
        <h2 v-if="title" class="text-base font-semibold text-slate-900">{{ title }}</h2>
        <p v-if="description" class="text-sm text-slate-500">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="isFlush ? '' : 'p-5'">
      <slot />
    </div>
  </section>
</template>
