<script setup lang="ts" generic="T extends string | number | null">
interface Props {
  label: string
  options: { value: T; label: string; isDisabled?: boolean }[]
  hint?: string
  error?: string | null
  isDisabled?: boolean
  /** ラベルを視覚的に隠す（フィルタなど、周囲の文脈で意味が分かる場合） */
  isLabelHidden?: boolean
}

withDefaults(defineProps<Props>(), { hint: undefined, error: null, isDisabled: false, isLabelHidden: false })

const model = defineModel<T>({ required: true })
const id = useId()
</script>

<template>
  <div class="space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-slate-700" :class="isLabelHidden ? 'sr-only' : ''">{{ label }}</label>
    <select
      :id="id"
      v-model="model"
      :disabled="isDisabled"
      class="block h-10 w-full rounded-lg border bg-white px-3 pr-8 text-sm focus:outline-2 focus:outline-offset-0 focus:outline-brand-500 disabled:bg-slate-50"
      :class="error ? 'border-rose-400' : 'border-slate-300'"
    >
      <option v-for="option in options" :key="String(option.value)" :value="option.value" :disabled="option.isDisabled">
        {{ option.label }}
      </option>
    </select>
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
