<script setup lang="ts">
interface Props {
  label: string
  type?: 'text' | 'email' | 'password' | 'url' | 'number' | 'datetime-local'
  placeholder?: string
  hint?: string
  error?: string | null
  isRequired?: boolean
  isDisabled?: boolean
  autocomplete?: string
  maxlength?: number
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: undefined,
  hint: undefined,
  error: null,
  isRequired: false,
  isDisabled: false,
  autocomplete: undefined,
  maxlength: undefined,
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
    <input
      :id="id"
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :required="isRequired"
      :disabled="isDisabled"
      :autocomplete="autocomplete"
      :maxlength="maxlength"
      :aria-invalid="error ? 'true' : undefined"
      class="block h-10 w-full rounded-lg border bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500 disabled:bg-slate-50 disabled:text-slate-500"
      :class="error ? 'border-rose-400' : 'border-slate-300'"
    >
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
