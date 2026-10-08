<script setup lang="ts">
import type { BatchResult, GbpReview } from '~/types/domain'

// 選んだ口コミに同じ文面で返信する。差し込みは口コミごとに展開してから送る（プレビューと送信内容を一致させる）

interface Props {
  reviews: GbpReview[]
}

const props = defineProps<Props>()
const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ finished: [result: BatchResult] }>()

const { replyToReviews } = useGbpReviews()
const { templates } = useReplyTemplates()
const { storeName } = useCurrentOrg()
const { isPending, errorMessage, run } = useActionState()

const body = ref('')
const templateId = ref('')
// 送信後に失敗した口コミ（親が選択を失敗分だけに絞るため、名前は送信時点で控えておく）
const failures = ref<{ id: string; reviewerName: string; message: string }[]>([])
const templateOptions = computed(() => [{ value: '', label: 'テンプレートを使う' }, ...templates.value.map(item => ({ value: item.id, label: item.name }))])

watch(templateId, (id) => {
  const template = templates.value.find(item => item.id === id)
  if (template) body.value = template.body
})
watch(isOpen, (value) => {
  if (!value) return
  body.value = ''
  templateId.value = ''
  failures.value = []
})

const expanded = computed(() => props.reviews.map(review => ({
  review,
  comment: expandReplyTemplate(body.value, { reviewerName: review.reviewerName, storeName: storeName(review.storeId) }),
})))
const tooLong = computed(() => expanded.value.filter(item => utf8ByteLength(item.comment) > MAX_REPLY_BYTES))
const canSubmit = computed(() => body.value.trim() !== '' && tooLong.value.length === 0 && props.reviews.length > 0)

async function onSubmit(): Promise<void> {
  const names = new Map(props.reviews.map(review => [review.id, review.reviewerName]))
  const result = await run(() => replyToReviews(expanded.value.map(item => ({ reviewId: item.review.id, comment: item.comment }))))
  if (!result) return
  failures.value = result.failed.map(item => ({ ...item, reviewerName: names.get(item.id) ?? item.id }))
  emit('finished', result)
  if (result.failed.length === 0) isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" :title="`${reviews.length} 件の口コミに返信`" size="lg">
    <div class="space-y-4">
      <div v-if="templates.length > 0" class="w-full sm:w-60">
        <UiInputSelectField v-model="templateId" label="テンプレート" :options="templateOptions" is-label-hidden />
      </div>
      <UiInputTextareaField v-model="body" label="返信の文面" :rows="5" :hint="`差し込み: ${REPLY_PLACEHOLDERS.join(' ')}`" />
      <div v-if="expanded[0] && body.trim()" class="space-y-1">
        <p class="text-xs font-medium text-slate-500">プレビュー（{{ expanded[0].review.reviewerName }} さんへの返信）</p>
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">{{ expanded[0].comment }}</p>
      </div>
      <UiCommonAlert v-if="tooLong.length > 0" tone="danger">{{ tooLong.length }} 件の返信が 4096 バイトを超えています。文面を短くしてください。</UiCommonAlert>
      <UiCommonAlert v-if="failures.length > 0" tone="danger">
        <p>{{ failures.length }} 件の返信に失敗しました。失敗した口コミだけが選択されています。文面を確認して再送してください。</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="item in failures" :key="item.id">{{ item.reviewerName }}：{{ item.message }}</li>
        </ul>
      </UiCommonAlert>
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    </div>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton :is-loading="isPending" :is-disabled="!canSubmit" @click="onSubmit">{{ reviews.length }} 件に返信する</UiCommonButton>
    </template>
  </UiCommonModal>
</template>
