<script setup lang="ts">
import type { BatchResult } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: '口コミ' })

// GBP の口コミ一覧。個別返信と、選んだ口コミへの一括返信

const MAX_SELECTION = 50

const { storeName } = useCurrentOrg()
const { reviews, syncReviews } = useGbpReviews()
const { show } = useToast()

const storeFilter = ref<string | null>(null)
const replyFilter = ref<'all' | 'unreplied' | 'replied'>('unreplied')
const ratingFilter = ref<'all' | '1' | '2' | '3' | '4' | '5'>('all')
const replyOptions = [
  { value: 'all' as const, label: 'すべて' },
  { value: 'unreplied' as const, label: '未返信' },
  { value: 'replied' as const, label: '返信済み' },
]
const ratingOptions = [
  { value: 'all' as const, label: 'すべての評価' },
  ...(['5', '4', '3', '2', '1'] as const).map(value => ({ value, label: `星 ${value}` })),
]

const filteredReviews = computed(() => reviews.value.filter(review =>
  (storeFilter.value === null || review.storeId === storeFilter.value)
  && (replyFilter.value === 'all' || (replyFilter.value === 'replied') === review.hasReply)
  && (ratingFilter.value === 'all' || review.starRating === Number(ratingFilter.value))))

const selectedIds = ref<string[]>([])
const selectedReviews = computed(() => reviews.value.filter(review => selectedIds.value.includes(review.id)))
const isAllSelected = computed(() =>
  filteredReviews.value.length > 0 && filteredReviews.value.slice(0, MAX_SELECTION).every(review => selectedIds.value.includes(review.id)))

function onSelect(reviewId: string, isSelected: boolean): void {
  selectedIds.value = isSelected ? [...selectedIds.value, reviewId] : selectedIds.value.filter(id => id !== reviewId)
}

function onSelectAll(isSelected: boolean): void {
  selectedIds.value = isSelected ? filteredReviews.value.slice(0, MAX_SELECTION).map(review => review.id) : []
}

const isBulkOpen = ref(false)
const isTemplatesOpen = ref(false)
const lastFailures = ref<BatchResult['failed']>([])

function onBulkFinished(result: BatchResult): void {
  lastFailures.value = result.failed
  // 失敗した口コミだけを選択状態に残し、再送できるようにする
  selectedIds.value = result.failed.map(item => item.id)
  if (result.succeeded.length > 0) show(`${result.succeeded.length} 件に返信しました`)
}

const syncState = useActionState()
async function onSync(): Promise<void> {
  const result = await syncState.run(() => syncReviews())
  if (!result) return
  lastFailures.value = result.failed
  if (result.failed.length === 0) show('口コミを同期しました')
  else show(`${result.failed.length} 店舗の同期に失敗しました`, 'danger')
}

function failureLabel(id: string): string {
  const review = reviews.value.find(item => item.id === id)
  return review ? `${review.reviewerName}（${storeName(review.storeId)}）` : storeName(id)
}
</script>

<template>
  <AdminCommonGoogleRequired>
    <div>
      <UiCommonPageHeader title="口コミ" description="Google の口コミを確認し、返信します（毎朝 6 時に自動で同期します）">
        <template #actions>
          <UiCommonButton variant="secondary" @click="isTemplatesOpen = true">テンプレート</UiCommonButton>
          <UiCommonButton icon="refresh" variant="secondary" :is-loading="syncState.isPending.value" @click="onSync">同期</UiCommonButton>
        </template>
      </UiCommonPageHeader>

      <div class="mb-4 flex flex-wrap gap-3">
        <AdminCommonStoreFilter v-model="storeFilter" />
        <div class="w-full sm:w-36">
          <UiInputSelectField v-model="replyFilter" label="返信" :options="replyOptions" is-label-hidden />
        </div>
        <div class="w-full sm:w-36">
          <UiInputSelectField v-model="ratingFilter" label="評価" :options="ratingOptions" is-label-hidden />
        </div>
      </div>

      <UiCommonAlert v-if="syncState.errorMessage.value" tone="danger" class="mb-4">{{ syncState.errorMessage.value }}</UiCommonAlert>
      <UiCommonAlert v-if="lastFailures.length > 0" tone="danger" title="処理できなかったもの" class="mb-4">
        <ul class="list-disc pl-5">
          <li v-for="failure in lastFailures" :key="failure.id">{{ failureLabel(failure.id) }}: {{ failure.message }}</li>
        </ul>
      </UiCommonAlert>

      <div class="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" class="size-4" :checked="isAllSelected" @change="onSelectAll(($event.target as HTMLInputElement).checked)">
          表示中をすべて選択（最大 {{ MAX_SELECTION }} 件）
        </label>
        <span class="text-sm text-slate-500">{{ selectedIds.length }} 件選択中</span>
        <UiCommonButton class="ml-auto" size="sm" :is-disabled="selectedIds.length === 0 || selectedIds.length > MAX_SELECTION" @click="isBulkOpen = true">
          一括返信
        </UiCommonButton>
      </div>

      <p v-if="filteredReviews.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        条件に合う口コミはありません。
      </p>
      <ul v-else class="grid gap-3">
        <GbpReviewsReviewCard
          v-for="review in filteredReviews"
          :key="review.id"
          :review="review"
          :store-name="storeName(review.storeId)"
          :is-selected="selectedIds.includes(review.id)"
          @update:is-selected="onSelect(review.id, $event)"
        />
      </ul>

      <GbpReviewsBulkReplyModal v-model="isBulkOpen" :reviews="selectedReviews" @finished="onBulkFinished" />
      <GbpReviewsTemplateManagerModal v-model="isTemplatesOpen" />
    </div>
  </AdminCommonGoogleRequired>
</template>
