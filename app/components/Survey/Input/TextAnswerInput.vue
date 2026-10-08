<script setup lang="ts">
interface Props {
  label: string
  maxlength?: number
}

withDefaults(defineProps<Props>(), { maxlength: 500 })

const model = defineModel<string | undefined>({ required: true })

const text = computed({
  get: () => model.value ?? '',
  set: (value: string) => { model.value = value },
})
</script>

<template>
  <div class="space-y-1">
    <textarea
      v-model="text"
      :aria-label="label"
      rows="4"
      :maxlength="maxlength"
      class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base leading-relaxed placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
      placeholder="ご自由にお書きください"
    />
    <p class="text-right text-xs text-slate-400 tabular-nums">{{ text.length }} / {{ maxlength }}</p>
  </div>
</template>
