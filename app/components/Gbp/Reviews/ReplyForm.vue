<script setup lang="ts">
import type { GbpReview } from '~/types/domain'

// 1 件の口コミへの返信（新規・編集）。テンプレートを選ぶと差し込みを展開して入力欄に入れる

interface Props {
  review: GbpReview
  storeName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ done: [] }>()

const { replyToReviews } = useGbpReviews()
const { templates } = useReplyTemplates()
const { isPending, errorMessage, run } = useActionState()

const comment = ref(props.review.reply?.comment ?? '')
const templateId = ref<string>('')
const byteLength = computed(() => utf8ByteLength(comment.value))
const templateOptions = computed(() => [{ value: '', label: 'テンプレートを使う' }, ...templates.value.map(item => ({ value: item.id, label: item.name }))])

watch(templateId, (id) => {
  const template = templates.value.find(item => item.id === id)
  if (template) comment.value = expandReplyTemplate(template.body, { reviewerName: props.review.reviewerName, storeName: props.storeName })
})

async function onSubmit(): Promise<void> {
  const result = await run(() => replyToReviews([{ reviewId: props.review.id, comment: comment.value.trim() }]))
  if (!result) return
  if (result.failed.length > 0) {
    errorMessage.value = result.failed[0]!.message
    return
  }
  emit('done')
}
</script>

<template>
  <form class="space-y-2" @submit.prevent="onSubmit">
    <div v-if="templates.length > 0" class="w-full sm:w-60">
      <UiInputSelectField v-model="templateId" label="テンプレート" :options="templateOptions" is-label-hidden />
    </div>
    <UiInputTextareaField
      v-model="comment"
      label="返信"
      :rows="4"
      :hint="`${byteLength} / ${MAX_REPLY_BYTES} バイト`"
      :error="byteLength > MAX_REPLY_BYTES ? '長すぎます（日本語は約 1,300 文字まで）' : null"
    />
    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <div class="flex justify-end gap-2">
      <UiCommonButton variant="secondary" size="sm" @click="emit('done')">キャンセル</UiCommonButton>
      <UiCommonButton type="submit" size="sm" :is-loading="isPending" :is-disabled="comment.trim() === '' || byteLength > MAX_REPLY_BYTES">
        {{ review.hasReply ? '返信を更新' : '返信する' }}
      </UiCommonButton>
    </div>
  </form>
</template>
