<script setup lang="ts">
interface Props {
  label: string
}

defineProps<Props>()

const model = defineModel<number | undefined>({ required: true })
const hoverValue = ref<number | null>(null)
const RATING_LABELS = ['', '不満', 'やや不満', '普通', '満足', 'とても満足']

const displayValue = computed(() => hoverValue.value ?? model.value ?? 0)
</script>

<template>
  <div role="radiogroup" :aria-label="label" class="space-y-2">
    <div class="flex justify-center gap-1.5" @mouseleave="hoverValue = null">
      <button
        v-for="value in 5"
        :key="value"
        type="button"
        role="radio"
        :aria-checked="model === value"
        :aria-label="`${value}（${RATING_LABELS[value]}）`"
        class="rounded-md p-1 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-brand-500"
        @mouseenter="hoverValue = value"
        @click="model = value"
      >
        <UiCommonIcon
          name="star"
          size-class="size-10"
          :class="value <= displayValue ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-slate-300'"
        />
      </button>
    </div>
    <p class="h-5 text-center text-sm text-slate-600">{{ RATING_LABELS[displayValue] }}</p>
  </div>
</template>
