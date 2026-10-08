<script setup lang="ts">
// 順位の増減。正の値は順位が上がった（数字が小さくなった）ことを表す。

interface Props {
  diff: number | null
  /** 読み上げ・ツールチップ用の比較対象（例: 前日比） */
  label?: string
}

const props = withDefaults(defineProps<Props>(), { label: '前回比' })

const text = computed(() => {
  if (props.diff === null) return '—'
  if (props.diff === 0) return '±0'
  return `${props.diff > 0 ? '↑' : '↓'}${Math.abs(props.diff)}`
})

const ariaLabel = computed(() => {
  if (props.diff === null) return `${props.label}: 比較できません`
  if (props.diff === 0) return `${props.label}: 変動なし`
  return `${props.label}: ${Math.abs(props.diff)} 位${props.diff > 0 ? '上昇' : '下降'}`
})
</script>

<template>
  <span
    class="inline-block text-sm font-medium tabular-nums"
    :class="diff === null || diff === 0 ? 'text-slate-500' : diff > 0 ? 'text-emerald-700' : 'text-rose-700'"
    :title="ariaLabel"
    :aria-label="ariaLabel"
  >
    {{ text }}
  </span>
</template>
