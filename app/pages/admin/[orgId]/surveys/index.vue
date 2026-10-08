<script setup lang="ts">
import type { Survey, SurveyStatus } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'アンケート' })

// F-06 アンケート一覧 / F-09 状態の確認

const { adminPath, storeName, visibleStores } = useCurrentOrg()
const { surveys, responseCount, responseCountNote, copySurvey } = useSurveys()
const { show } = useToast()

const storeFilter = ref<string | null>(null)
const statusFilter = ref<SurveyStatus | 'all'>('all')

const statusOptions = [
  { value: 'all' as const, label: 'すべての状態' },
  ...(Object.keys(SURVEY_STATUS_LABELS) as SurveyStatus[]).map(status => ({ value: status, label: SURVEY_STATUS_LABELS[status] })),
]

const filteredSurveys = computed(() =>
  surveys.value.filter(survey =>
    (storeFilter.value === null || survey.storeId === storeFilter.value)
    && (statusFilter.value === 'all' || survey.status === statusFilter.value)))

// 複製
const copySource = ref<Survey | null>(null)
const copyStoreId = ref('')
const { isPending: isCopying, errorMessage: copyError, run } = useActionState()
const isCopyModalOpen = computed({
  get: () => copySource.value !== null,
  set: (value: boolean) => { if (!value) copySource.value = null },
})
const storeOptions = computed(() => visibleStores.value.map(store => ({ value: store.id, label: store.name })))

function onOpenCopy(survey: Survey): void {
  copySource.value = survey
  copyStoreId.value = survey.storeId
}

async function onCopy(): Promise<void> {
  if (!copySource.value) return
  const created = await run(() => copySurvey(copySource.value!.id, copyStoreId.value))
  if (!created) return
  copySource.value = null
  show('アンケートを複製しました')
  await navigateTo(adminPath(`/surveys/${created.id}/edit`))
}
</script>

<template>
  <div>
    <UiCommonPageHeader title="アンケート" description="店舗ごとの口コミアンケートを作成・公開します">
      <template #actions>
        <UiCommonButton icon="plus" :to="adminPath('/surveys/new')">新規作成</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <div class="mb-4 flex flex-wrap gap-3">
      <AdminCommonStoreFilter v-model="storeFilter" />
      <div class="w-full sm:w-44">
        <UiInputSelectField v-model="statusFilter" label="状態" :options="statusOptions" is-label-hidden />
      </div>
    </div>

    <div v-if="filteredSurveys.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p class="text-sm text-slate-500">条件に合うアンケートはありません。</p>
      <UiCommonButton class="mt-4" icon="plus" :to="adminPath('/surveys/new')">アンケートを作成</UiCommonButton>
    </div>

    <ul v-else class="grid gap-3">
      <li v-for="survey in filteredSurveys" :key="survey.id" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <NuxtLink :to="adminPath(`/surveys/${survey.id}`)" class="font-semibold text-slate-900 hover:text-brand-700">
                {{ survey.title }}
              </NuxtLink>
              <AdminCommonSurveyStatusBadge :status="survey.status" />
              <UiCommonBadge v-if="survey.hasUnpublishedChanges" tone="warning">未公開の変更あり</UiCommonBadge>
            </div>
            <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              <span class="inline-flex items-center gap-1"><UiCommonIcon name="store" size-class="size-4" />{{ storeName(survey.storeId) }}</span>
              <span>回答 <span class="font-medium text-slate-700 tabular-nums">{{ responseCount(survey.id) }}</span> 件<template v-if="responseCountNote">（{{ responseCountNote }}）</template></span>
              <span>更新 {{ formatDateTime(survey.updatedAt) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UiCommonButton variant="secondary" size="sm" :to="adminPath(`/surveys/${survey.id}/responses`)">回答</UiCommonButton>
            <UiCommonButton v-if="survey.status !== 'closed'" variant="secondary" size="sm" :to="adminPath(`/surveys/${survey.id}/edit`)">編集</UiCommonButton>
            <UiCommonButton variant="ghost" size="sm" icon="copy" @click="onOpenCopy(survey)">複製</UiCommonButton>
          </div>
        </div>
      </li>
    </ul>

    <UiCommonModal v-model="isCopyModalOpen" title="アンケートを複製">
      <div class="space-y-4">
        <p class="text-sm text-slate-600">「{{ copySource?.title }}」の下書きをコピーして、新しいアンケートを作成します。</p>
        <UiInputSelectField v-model="copyStoreId" label="複製先の店舗" :options="storeOptions" />
        <UiCommonAlert v-if="copyError" tone="danger">{{ copyError }}</UiCommonAlert>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isCopyModalOpen = false">キャンセル</UiCommonButton>
        <UiCommonButton :is-loading="isCopying" :is-disabled="!copyStoreId" @click="onCopy">複製する</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
