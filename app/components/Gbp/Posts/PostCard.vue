<script setup lang="ts">
import type { GbpPost } from '~/types/domain'

interface Props {
  post: GbpPost
  storeName: string
}

const props = defineProps<Props>()

const { deletePost } = useGbpPosts()
const { show } = useToast()
const deleteState = useActionState()
const isConfirmingDelete = ref(false)

const period = computed(() => props.post.event
  ? `${props.post.event.startAt.replace('T', ' ')} 〜 ${props.post.event.endAt.replace('T', ' ')}`
  : null)

// 削除は Google 側の投稿も消えて元に戻せないため、確認してから実行する
async function onDelete(): Promise<void> {
  await deleteState.run(() => deletePost(props.post.id))
  if (deleteState.errorMessage.value) return
  isConfirmingDelete.value = false
  show('投稿を削除しました')
}
</script>

<template>
  <li class="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <img v-if="post.mediaUrl" :src="post.mediaUrl" alt="" class="hidden size-24 shrink-0 rounded-lg object-cover sm:block">
    <div class="min-w-0 flex-1 space-y-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <UiCommonBadge tone="brand">{{ TOPIC_TYPE_LABELS[post.topicType] }}</UiCommonBadge>
        <UiCommonBadge :tone="POST_STATE_TONES[post.state]">{{ POST_STATE_LABELS[post.state] }}</UiCommonBadge>
        <span class="text-xs text-slate-500">{{ storeName }}・{{ formatDate(post.createdAt) }}</span>
      </div>
      <p v-if="post.event" class="font-medium text-slate-900">{{ post.event.title }}</p>
      <p v-if="period" class="text-xs text-slate-500">{{ period }}</p>
      <p v-if="post.summary" class="text-sm whitespace-pre-wrap text-slate-700">{{ post.summary }}</p>
      <p v-if="post.offer?.couponCode" class="text-xs text-slate-500">クーポンコード: {{ post.offer.couponCode }}</p>
      <p v-if="post.callToAction" class="text-xs text-slate-500">ボタン: {{ CALL_TO_ACTION_LABELS[post.callToAction.actionType] }}</p>
      <UiCommonAlert v-if="post.state === 'FAILED' && post.errorMessage" tone="warning">{{ post.errorMessage }}</UiCommonAlert>
      <div class="flex flex-wrap gap-2">
        <!-- UiCommonButton の to は同じタブで開くため、外部リンクは新しいタブで開く a にする（見た目は secondary / sm と同じ） -->
        <a
          v-if="post.searchUrl"
          :href="post.searchUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <UiCommonIcon name="external" size-class="size-4" />
          Google で見る
        </a>
        <UiCommonButton size="sm" variant="ghost" icon="trash" @click="isConfirmingDelete = true">削除</UiCommonButton>
      </div>
    </div>
    <UiCommonModal v-model="isConfirmingDelete" title="投稿を削除しますか？">
      <p class="text-sm text-slate-700">
        {{ storeName }} の投稿を{{ post.postName ? ' Google ビジネスプロフィールから' : '' }}削除します。この操作は元に戻せません。
      </p>
      <UiCommonAlert v-if="deleteState.errorMessage.value" tone="danger" class="mt-3">{{ deleteState.errorMessage.value }}</UiCommonAlert>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isConfirmingDelete = false">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="deleteState.isPending.value" @click="onDelete">削除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </li>
</template>
