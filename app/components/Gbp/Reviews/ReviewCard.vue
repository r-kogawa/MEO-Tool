<script setup lang="ts">
import type { GbpReview } from '~/types/domain'

interface Props {
  review: GbpReview
  storeName: string
  isSelected: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:isSelected': [value: boolean] }>()

const { deleteReply } = useGbpReviews()
const { show } = useToast()
const deleteState = useActionState()
const isEditing = ref(false)
const isConfirmingDelete = ref(false)

// 削除は Google 側の返信も消えて元に戻せないため、確認してから実行する
async function onDeleteReply(): Promise<void> {
  await deleteState.run(() => deleteReply(props.review.id))
  isConfirmingDelete.value = false
  if (!deleteState.errorMessage.value) show('返信を削除しました')
}
</script>

<template>
  <li class="rounded-xl border bg-white p-4 sm:p-5" :class="isSelected ? 'border-brand-400 ring-1 ring-brand-200' : 'border-slate-200'">
    <div class="flex items-start gap-3">
      <input
        type="checkbox"
        class="mt-1 size-4"
        :checked="isSelected"
        :aria-label="`${review.reviewerName} の口コミを選択`"
        @change="emit('update:isSelected', ($event.target as HTMLInputElement).checked)"
      >
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-medium text-slate-900">{{ review.reviewerName }}</span>
          <GbpReviewsStarRating :rating="review.starRating" />
          <span class="text-xs text-slate-500">{{ storeName }}・{{ formatDate(review.reviewCreatedAt) }}</span>
          <UiCommonBadge :tone="review.hasReply ? 'success' : 'warning'">{{ review.hasReply ? '返信済み' : '未返信' }}</UiCommonBadge>
        </div>
        <p class="text-sm whitespace-pre-wrap text-slate-700">{{ review.comment ?? '（評価のみ）' }}</p>

        <div v-if="review.reply && !isEditing" class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <p class="text-xs text-slate-500">オーナーからの返信・{{ formatDate(review.reply.updatedAt) }}</p>
          <p class="whitespace-pre-wrap text-slate-700">{{ review.reply.comment }}</p>
          <div class="mt-2 flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="isEditing = true">編集</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" :is-loading="deleteState.isPending.value" @click="isConfirmingDelete = true">削除</UiCommonButton>
          </div>
          <UiCommonAlert v-if="deleteState.errorMessage.value" tone="danger" class="mt-2">{{ deleteState.errorMessage.value }}</UiCommonAlert>
        </div>
        <GbpReviewsReplyForm v-else-if="isEditing" :review="review" :store-name="storeName" @done="isEditing = false" />
        <UiCommonButton v-else size="sm" variant="secondary" @click="isEditing = true">返信する</UiCommonButton>
      </div>
    </div>
    <UiCommonModal v-model="isConfirmingDelete" title="返信を削除しますか？">
      <p class="text-sm text-slate-700">{{ review.reviewerName }} さんの口コミへの返信を Google ビジネスプロフィールから削除します。この操作は元に戻せません。</p>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isConfirmingDelete = false">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="deleteState.isPending.value" @click="onDeleteReply">削除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </li>
</template>
