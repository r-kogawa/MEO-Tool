<script setup lang="ts">
interface Props {
  rating: number | null
}

defineProps<Props>()
</script>

<template>
  <span class="inline-flex items-center gap-0.5" :aria-label="rating ? `星 ${rating}` : '評価なし'">
    <UiCommonIcon
      v-for="index in 5"
      :key="index"
      name="star"
      size-class="size-4"
      :class="rating && index <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'"
    />
  </span>
</template>
