<script setup lang="ts">
import type { BatchResult, GbpCallToActionType, GbpPostInput, GbpPostTopicType } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: '投稿を作成' })

// GBP への投稿。1 店舗なら個別、複数なら一括（同じ関数）。失敗した店舗だけを選択に残して再送できる

const router = useRouter()
const { adminPath, storeName, visibleStores } = useCurrentOrg()
const { createPosts, uploadImage } = useGbpPosts()
const { show } = useToast()

const linkedStores = computed(() => visibleStores.value.filter(store => store.status === 'active' && store.gbpLocationName))
const storeIds = ref<string[]>([])
const topicType = ref<GbpPostTopicType>('STANDARD')
const summary = ref('')
const imageFile = ref<File | null>(null)
const actionType = ref<GbpCallToActionType | ''>('')
const actionUrl = ref('')
const eventTitle = ref('')
const startAt = ref('')
const endAt = ref('')
const couponCode = ref('')
const redeemOnlineUrl = ref('')
const termsConditions = ref('')

// 再送では同じ requestId を使い、作成済みの店舗に二重投稿しない。画像も同じファイルならアップロードし直さない
const requestId = crypto.randomUUID()
let uploaded: { file: File; url: string } | null = null

const topicOptions = (Object.keys(TOPIC_TYPE_LABELS) as GbpPostTopicType[]).map(value => ({ value, label: TOPIC_TYPE_LABELS[value] }))
const actionOptions = [
  { value: '' as const, label: 'ボタンなし' },
  ...(Object.keys(CALL_TO_ACTION_LABELS) as GbpCallToActionType[]).map(value => ({ value, label: CALL_TO_ACTION_LABELS[value] })),
]
const hasEvent = computed(() => topicType.value !== 'STANDARD')
const canUseButton = computed(() => topicType.value !== 'OFFER')
const needsActionUrl = computed(() => canUseButton.value && actionType.value !== '' && actionType.value !== 'CALL')

const canSubmit = computed(() =>
  storeIds.value.length > 0 && storeIds.value.length <= MAX_POST_STORES
  && (topicType.value !== 'STANDARD' || summary.value.trim() !== '')
  && (!hasEvent.value || (eventTitle.value.trim() !== '' && startAt.value !== '' && endAt.value !== ''))
  && (!needsActionUrl.value || actionUrl.value.trim() !== ''))

function buildPost(mediaUrl: string | null): GbpPostInput {
  const button = canUseButton.value && actionType.value !== '' ? actionType.value : null
  return {
    topicType: topicType.value,
    summary: summary.value,
    mediaUrl,
    callToAction: button ? { actionType: button, url: button === 'CALL' ? null : actionUrl.value } : null,
    event: hasEvent.value ? { title: eventTitle.value, startAt: startAt.value, endAt: endAt.value } : null,
    offer: topicType.value === 'OFFER'
      ? { couponCode: couponCode.value, redeemOnlineUrl: redeemOnlineUrl.value, termsConditions: termsConditions.value }
      : null,
  }
}

async function mediaUrlOf(): Promise<string | null> {
  const file = imageFile.value
  if (!file) return null
  if (uploaded?.file !== file) uploaded = { file, url: await uploadImage(file) }
  return uploaded.url
}

const { isPending, errorMessage, run } = useActionState()
const failures = ref<BatchResult['failed']>([])

async function onSubmit(): Promise<void> {
  const result = await run(async () => createPosts(requestId, storeIds.value, buildPost(await mediaUrlOf())))
  if (!result) return
  failures.value = result.failed
  if (result.succeeded.length > 0) show(`${result.succeeded.length} 店舗に投稿しました`)
  if (result.failed.length === 0) {
    await router.push(adminPath('/posts'))
    return
  }
  // 失敗した店舗だけを選択に残す（同じ requestId で再送すると、成功済みの店舗は作り直さない）
  storeIds.value = result.failed.map(item => item.id)
}
</script>

<template>
  <AdminCommonGoogleRequired>
    <div class="max-w-3xl space-y-6">
      <UiCommonPageHeader title="投稿を作成" description="1 店舗を選ぶと個別投稿、複数選ぶと同じ内容で一括投稿します" :back-to="adminPath('/posts')" back-label="投稿一覧" />

      <UiCommonCard title="投稿する店舗">
        <GbpInputStoreCheckboxList v-model="storeIds" :stores="linkedStores" :max-items="MAX_POST_STORES" />
      </UiCommonCard>

      <UiCommonCard title="内容">
        <div class="space-y-5">
          <div class="w-full sm:w-60">
            <UiInputSelectField v-model="topicType" label="種類" :options="topicOptions" />
          </div>
          <template v-if="hasEvent">
            <UiInputTextField v-model="eventTitle" :label="topicType === 'OFFER' ? '特典のタイトル' : 'イベントのタイトル'" :maxlength="POST_TITLE_MAX" is-required />
            <div class="grid gap-4 sm:grid-cols-2">
              <UiInputTextField v-model="startAt" label="開始日時" type="datetime-local" is-required />
              <UiInputTextField v-model="endAt" label="終了日時" type="datetime-local" is-required />
            </div>
          </template>
          <UiInputTextareaField
            v-model="summary"
            :label="topicType === 'STANDARD' ? '本文' : '本文（任意）'"
            :rows="6"
            :maxlength="POST_SUMMARY_MAX"
            :is-required="topicType === 'STANDARD'"
          />
          <GbpInputImageInput v-model="imageFile" :is-disabled="isPending" />
        </div>
      </UiCommonCard>

      <UiCommonCard v-if="topicType === 'OFFER'" title="特典の詳細（任意）">
        <div class="space-y-4">
          <UiInputTextField v-model="couponCode" label="クーポンコード" :maxlength="POST_TITLE_MAX" />
          <UiInputTextField v-model="redeemOnlineUrl" label="特典のリンク先" type="url" placeholder="https://example.com/coupon" />
          <UiInputTextareaField v-model="termsConditions" label="利用規約" :rows="3" />
        </div>
      </UiCommonCard>

      <UiCommonCard v-if="canUseButton" title="ボタン（任意）">
        <div class="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <UiInputSelectField v-model="actionType" label="ボタンの種類" :options="actionOptions" />
          <UiInputTextField v-if="needsActionUrl" v-model="actionUrl" label="リンク先" type="url" placeholder="https://example.com" is-required />
        </div>
      </UiCommonCard>

      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
      <UiCommonAlert v-if="failures.length > 0" tone="danger" title="投稿できなかった店舗">
        <p>失敗した店舗だけが選択されています。内容を確認して、もう一度送信してください。</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="failure in failures" :key="failure.id">{{ storeName(failure.id) }}: {{ failure.message }}</li>
        </ul>
      </UiCommonAlert>

      <div class="flex justify-end gap-2">
        <UiCommonButton variant="secondary" :to="adminPath('/posts')">キャンセル</UiCommonButton>
        <UiCommonButton :is-loading="isPending" :is-disabled="!canSubmit" @click="onSubmit">
          {{ storeIds.length > 1 ? `${storeIds.length} 店舗に投稿する` : '投稿する' }}
        </UiCommonButton>
      </div>
    </div>
  </AdminCommonGoogleRequired>
</template>
