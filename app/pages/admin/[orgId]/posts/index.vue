<script setup lang="ts">
import type { BatchResult, GbpPostState, GbpPostTopicType } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: '投稿' })

// GBP の投稿一覧。種類・状態で絞り込み、削除と同期ができる

const { adminPath, storeName } = useCurrentOrg()
const { posts, syncPosts } = useGbpPosts()
const { show } = useToast()

const storeFilter = ref<string | null>(null)
const typeFilter = ref<'all' | GbpPostTopicType>('all')
const stateFilter = ref<'all' | GbpPostState>('all')
const typeOptions = [
  { value: 'all' as const, label: 'すべての種類' },
  ...(Object.keys(TOPIC_TYPE_LABELS) as GbpPostTopicType[]).map(value => ({ value, label: TOPIC_TYPE_LABELS[value] })),
]
const stateOptions = [
  { value: 'all' as const, label: 'すべての状態' },
  ...(Object.keys(POST_STATE_LABELS) as GbpPostState[]).map(value => ({ value, label: POST_STATE_LABELS[value] })),
]

const filteredPosts = computed(() => posts.value.filter(post =>
  (storeFilter.value === null || post.storeId === storeFilter.value)
  && (typeFilter.value === 'all' || post.topicType === typeFilter.value)
  && (stateFilter.value === 'all' || post.state === stateFilter.value)))

const syncFailures = ref<BatchResult['failed']>([])
const syncState = useActionState()
async function onSync(): Promise<void> {
  const result = await syncState.run(() => syncPosts())
  if (!result) return
  syncFailures.value = result.failed
  if (result.failed.length === 0) show('投稿を同期しました')
  else show(`${result.failed.length} 店舗の同期に失敗しました`, 'danger')
}
</script>

<template>
  <div>
    <UiCommonPageHeader title="投稿" description="Google ビジネスプロフィールの投稿（最新情報・イベント・特典）を管理します">
      <template #actions>
        <UiCommonButton icon="refresh" variant="secondary" :is-loading="syncState.isPending.value" @click="onSync">同期</UiCommonButton>
        <UiCommonButton icon="plus" :to="adminPath('/posts/new')">投稿を作成</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <div class="mb-4 flex flex-wrap gap-3">
      <AdminCommonStoreFilter v-model="storeFilter" />
      <div class="w-full sm:w-40">
        <UiInputSelectField v-model="typeFilter" label="種類" :options="typeOptions" is-label-hidden />
      </div>
      <div class="w-full sm:w-40">
        <UiInputSelectField v-model="stateFilter" label="状態" :options="stateOptions" is-label-hidden />
      </div>
    </div>

    <UiCommonAlert v-if="syncState.errorMessage.value" tone="danger" class="mb-4">{{ syncState.errorMessage.value }}</UiCommonAlert>
    <UiCommonAlert v-if="syncFailures.length > 0" tone="danger" title="同期できなかった店舗" class="mb-4">
      <ul class="list-disc pl-5">
        <li v-for="failure in syncFailures" :key="failure.id">{{ storeName(failure.id) }}: {{ failure.message }}</li>
      </ul>
    </UiCommonAlert>

    <p v-if="filteredPosts.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
      条件に合う投稿はありません。
    </p>
    <ul v-else class="grid gap-3">
      <GbpPostsPostCard v-for="post in filteredPosts" :key="post.id" :post="post" :store-name="storeName(post.storeId)" />
    </ul>
  </div>
</template>
