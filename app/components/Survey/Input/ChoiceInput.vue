<script setup lang="ts">
import type { QuestionOption } from '~/types/domain'

interface Props {
  label: string
  options: QuestionOption[]
  isMultiple: boolean
}

const props = defineProps<Props>()

const model = defineModel<string | string[] | undefined>({ required: true })

function isSelected(optionId: string): boolean {
  return Array.isArray(model.value) ? model.value.includes(optionId) : model.value === optionId
}

function onToggle(optionId: string): void {
  if (!props.isMultiple) {
    model.value = optionId
    return
  }
  const current = Array.isArray(model.value) ? model.value : []
  model.value = current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId]
}
</script>

<template>
  <div :role="isMultiple ? 'group' : 'radiogroup'" :aria-label="label" class="grid gap-2">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :role="isMultiple ? 'checkbox' : 'radio'"
      :aria-checked="isSelected(option.id)"
      class="flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500"
      :class="isSelected(option.id) ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'"
      @click="onToggle(option.id)"
    >
      <span
        class="flex size-5 shrink-0 items-center justify-center border"
        :class="[
          isMultiple ? 'rounded' : 'rounded-full',
          isSelected(option.id) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
        ]"
      >
        <UiCommonIcon v-if="isSelected(option.id)" name="check" size-class="size-3.5" />
      </span>
      {{ option.label }}
    </button>
  </div>
</template>
