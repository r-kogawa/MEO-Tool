<script setup lang="ts">
interface Props {
  label: string
}

defineProps<Props>()

const model = defineModel<number | undefined>({ required: true })
</script>

<template>
  <div role="radiogroup" :aria-label="label" class="space-y-2">
    <div class="grid grid-cols-11 gap-1">
      <button
        v-for="value in 11"
        :key="value - 1"
        type="button"
        role="radio"
        :aria-checked="model === value - 1"
        class="flex h-10 items-center justify-center rounded-md border text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-brand-500"
        :class="model === value - 1 ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-brand-50'"
        @click="model = value - 1"
      >
        {{ value - 1 }}
      </button>
    </div>
    <div class="flex justify-between text-xs text-slate-500">
      <span>すすめない</span>
      <span>ぜひすすめたい</span>
    </div>
  </div>
</template>
