<script setup lang="ts">
interface Props {
  label: string
  description?: string
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { description: undefined, isDisabled: false })

const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="flex cursor-pointer items-start gap-2.5 text-sm" :class="isDisabled ? 'cursor-not-allowed opacity-60' : ''">
    <input v-model="model" type="checkbox" :disabled="isDisabled" class="mt-0.5 size-4 rounded border-slate-300 accent-brand-600">
    <span class="space-y-0.5">
      <span class="block text-slate-800">{{ label }}</span>
      <span v-if="description" class="block text-xs text-slate-500">{{ description }}</span>
    </span>
  </label>
</template>
