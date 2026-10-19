<script setup lang="ts">
interface Props {
  label: string
  value: string | number
  /** 補足（期間・内訳など） */
  sub?: string
  /** 前期間との差。正なら増加 */
  diff?: number | null
  diffUnit?: string
}

withDefaults(defineProps<Props>(), { sub: undefined, diff: null, diffUnit: '' })
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white p-4">
    <p class="text-sm text-slate-500">{{ label }}</p>
    <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{{ value }}</p>
    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span
        v-if="diff !== null"
        class="font-medium tabular-nums"
        :class="diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-slate-500'"
      >
        {{ diff > 0 ? '+' : '' }}{{ diff }}{{ diffUnit }}
      </span>
      <span v-if="sub" class="text-slate-500">{{ sub }}</span>
    </div>
  </div>
</template>
