<script setup lang="ts">
interface Props {
  label: string
  placeholder?: string
  hint?: string
  error?: string | null
  rows?: number
  maxlength?: number
  isRequired?: boolean
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), {
  placeholder: undefined,
  hint: undefined,
  error: null,
  rows: 4,
  maxlength: undefined,
  isRequired: false,
  isDisabled: false,
})

const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <div class="space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-slate-700">
      {{ label }}
      <span v-if="isRequired" class="ml-1 text-xs text-rose-600">必須</span>
    </label>
    <textarea
      :id="id"
      v-model="model"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :required="isRequired"
      :disabled="isDisabled"
      :aria-invalid="error ? 'true' : undefined"
      class="block w-full rounded-lg border bg-white px-3 py-2 text-sm leading-relaxed placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500 disabled:bg-slate-50"
      :class="error ? 'border-rose-400' : 'border-slate-300'"
    />
    <div class="flex justify-between gap-2 text-xs">
      <p v-if="error" class="text-rose-700">{{ error }}</p>
      <p v-else-if="hint" class="text-slate-500">{{ hint }}</p>
      <p v-if="maxlength" class="ml-auto text-slate-400 tabular-nums">{{ model.length }} / {{ maxlength }}</p>
    </div>
  </div>
</template>
