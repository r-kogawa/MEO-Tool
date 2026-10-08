<script setup lang="ts">
// 投稿画像を 1 枚選ぶ（JPEG / PNG・5MB 以下）。アップロードは送信時に行う

interface Props {
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { isDisabled: false })
const model = defineModel<File | null>({ required: true })

const error = ref<string | null>(null)
const previewUrl = ref<string | null>(null)

watch(model, (file) => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = file ? URL.createObjectURL(file) : null
}, { immediate: true })
onBeforeUnmount(() => { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value) })

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  error.value = validatePostImage(file)
  if (!error.value) model.value = file
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm font-medium text-slate-700">画像（任意・1 枚）</p>
    <div v-if="previewUrl" class="flex items-start gap-3">
      <img :src="previewUrl" alt="選択した画像" class="h-32 w-48 rounded-lg border border-slate-200 object-cover">
      <UiCommonButton size="sm" variant="ghost" icon="trash" :is-disabled="isDisabled" @click="model = null">外す</UiCommonButton>
    </div>
    <label v-else class="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500" :class="isDisabled ? 'cursor-not-allowed opacity-60' : ''">
      <UiCommonIcon name="image" />
      画像を選ぶ（JPEG / PNG・5MB 以下）
      <input type="file" accept="image/jpeg,image/png" class="sr-only" :disabled="isDisabled" @change="onChange">
    </label>
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
  </div>
</template>
