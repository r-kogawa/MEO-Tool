<script setup lang="ts">
import type { SurveyStatusAction } from '~/types/domain'

definePageMeta({ layout: 'admin' })

// F-09 公開管理（状態・公開 URL・QR・公開期間・公開履歴）

const route = useRoute()
const surveyId = String(route.params.surveyId)
const { adminPath, storeName } = useCurrentOrg()
const { findSurvey, responseCount, responseCountNote } = useSurveys()
const visibleSurvey = findSurvey(surveyId)
const { versions, publishErrors, publicUrl, publish, changeStatus, regenerateSlug, updatePeriod } = useSurveyPublish(surveyId)
const { show } = useToast()
const { isPending, errorMessage, run } = useActionState()

useHead({ title: () => visibleSurvey.value?.title ?? 'アンケート' })

const survey = computed(() => visibleSurvey.value)
const canPublish = computed(() => publishErrors.value.length === 0)
const isPublic = computed(() => survey.value?.status === 'published' || survey.value?.status === 'paused')

async function onPublish(): Promise<void> {
  const isFirst = survey.value?.currentVersion === null
  const result = await run(publish)
  if (result) show(isFirst ? 'アンケートを公開しました' : '変更を公開しました')
}

const STATUS_MESSAGES: Record<SurveyStatusAction, string> = {
  pause: '受付を一時停止しました',
  resume: '受付を再開しました',
  close: 'アンケートを終了しました',
}

async function onChangeStatus(action: SurveyStatusAction): Promise<void> {
  const result = await run(() => changeStatus(action))
  if (result) show(STATUS_MESSAGES[action])
}

// 終了・URL 再発行は取り消せないため確認する
type ConfirmAction = 'close' | 'slug'
const confirmAction = ref<ConfirmAction | null>(null)
const isConfirmOpen = computed({
  get: () => confirmAction.value !== null,
  set: (value: boolean) => { if (!value) confirmAction.value = null },
})

async function onConfirm(): Promise<void> {
  const action = confirmAction.value
  confirmAction.value = null
  if (action === 'close') await onChangeStatus('close')
  if (action === 'slug') {
    const slug = await run(regenerateSlug)
    if (slug) show('URL を再発行しました。新しい QR コードを配布してください')
  }
}

// 公開期間（datetime-local は秒なしのローカル時刻）
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const periodStart = ref('')
const periodEnd = ref('')
watch(() => survey.value?.publishPeriod, (period) => {
  periodStart.value = toLocalInput(period?.startAt ?? null)
  periodEnd.value = toLocalInput(period?.endAt ?? null)
}, { immediate: true })

const period = useActionState()

async function onSavePeriod(): Promise<void> {
  const toIso = (value: string) => (value ? new Date(value).toISOString() : null)
  await period.run(() => updatePeriod({ startAt: toIso(periodStart.value), endAt: toIso(periodEnd.value) }))
  if (!period.errorMessage.value) show('公開期間を保存しました')
}

async function onCopyUrl(): Promise<void> {
  await copyToClipboard(publicUrl.value, '公開 URL をコピーしました')
}
</script>

<template>
  <div v-if="!survey" class="space-y-4">
    <UiCommonPageHeader title="アンケートが見つかりません" :back-to="adminPath('/surveys')" back-label="アンケート一覧" />
    <UiCommonAlert tone="warning">削除されたか、閲覧権限のないアンケートです。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader :title="survey.title" :description="storeName(survey.storeId)" :back-to="adminPath('/surveys')" back-label="アンケート一覧">
      <template #badge>
        <AdminCommonSurveyStatusBadge :status="survey.status" />
      </template>
      <template #actions>
        <UiCommonButton variant="secondary" :to="adminPath(`/surveys/${surveyId}/responses`)">回答を見る（{{ responseCount(surveyId) }}{{ responseCountNote ? `・${responseCountNote}` : '' }}）</UiCommonButton>
        <UiCommonButton v-if="survey.status !== 'closed'" variant="secondary" :to="adminPath(`/surveys/${surveyId}/edit`)">編集</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert v-if="errorMessage" tone="danger" title="操作できませんでした">{{ errorMessage }}</UiCommonAlert>

    <UiCommonCard title="公開状態">
      <div class="space-y-4">
        <UiCommonAlert v-if="survey.hasUnpublishedChanges && survey.status !== 'closed'" tone="warning" title="未公開の変更があります">
          編集した内容はまだ回答画面に反映されていません。「変更を公開」を押すと新しいバージョンとして公開されます。
        </UiCommonAlert>

        <UiCommonAlert v-if="survey.status !== 'closed' && !canPublish" tone="danger" title="公開前に次の点を修正してください">
          <ul class="list-disc pl-5">
            <li v-for="error in publishErrors" :key="error">{{ error }}</li>
          </ul>
        </UiCommonAlert>

        <p class="text-sm text-slate-600">
          <template v-if="survey.status === 'draft'">まだ公開されていません。公開すると回答画面の URL で回答を受け付けます。</template>
          <template v-else-if="survey.status === 'published'">回答を受け付けています（バージョン {{ survey.currentVersion }}）。</template>
          <template v-else-if="survey.status === 'paused'">受付を一時停止しています。回答画面には「受付停止中」と表示されます。</template>
          <template v-else>終了したアンケートです。回答画面の URL は無効になっています。</template>
        </p>

        <div class="flex flex-wrap gap-2">
          <UiCommonButton v-if="survey.status === 'draft'" icon="check" :is-loading="isPending" :is-disabled="!canPublish" @click="onPublish">
            公開する
          </UiCommonButton>
          <UiCommonButton
            v-if="isPublic"
            :variant="survey.hasUnpublishedChanges ? 'primary' : 'secondary'"
            icon="refresh"
            :is-loading="isPending"
            :is-disabled="!canPublish || !survey.hasUnpublishedChanges"
            @click="onPublish"
          >
            変更を公開
          </UiCommonButton>
          <UiCommonButton v-if="survey.status === 'published'" variant="secondary" :is-disabled="isPending" @click="onChangeStatus('pause')">一時停止</UiCommonButton>
          <UiCommonButton v-if="survey.status === 'paused'" variant="secondary" :is-disabled="isPending" @click="onChangeStatus('resume')">再開</UiCommonButton>
          <UiCommonButton v-if="isPublic" variant="danger" :is-disabled="isPending" @click="confirmAction = 'close'">終了する</UiCommonButton>
        </div>
      </div>
    </UiCommonCard>

    <UiCommonCard v-if="isPublic" title="配布" description="店頭の POP やレシートに QR コードを載せて回答を案内します">
      <div class="space-y-5">
        <div class="space-y-2">
          <p class="text-sm font-medium text-slate-700">公開 URL</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-sm">{{ publicUrl }}</code>
            <UiCommonButton variant="secondary" size="sm" icon="copy" @click="onCopyUrl">コピー</UiCommonButton>
            <a :href="publicUrl" target="_blank" rel="noopener" class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              <UiCommonIcon name="external" size-class="size-4" />開く
            </a>
          </div>
        </div>
        <SurveyEditorPublishQrCode :url="publicUrl" :file-name="`qr-${survey.publicSlug}`" />
        <div class="border-t border-slate-100 pt-4">
          <UiCommonButton variant="ghost" size="sm" icon="refresh" @click="confirmAction = 'slug'">URL を再発行する</UiCommonButton>
          <p class="mt-1 text-xs text-slate-500">URL が漏れた場合などに使います。旧 URL と配布済みの QR コードは使えなくなります。</p>
        </div>
      </div>
    </UiCommonCard>

    <UiCommonCard v-if="survey.status !== 'closed'" title="公開期間" description="期間外は回答画面に「受付期間外」と表示されます。空欄は制限なしです">
      <form class="space-y-4" @submit.prevent="onSavePeriod">
        <div class="grid gap-4 sm:grid-cols-2">
          <UiInputTextField v-model="periodStart" type="datetime-local" label="開始日時" />
          <UiInputTextField v-model="periodEnd" type="datetime-local" label="終了日時" />
        </div>
        <UiCommonAlert v-if="period.errorMessage.value" tone="danger">{{ period.errorMessage.value }}</UiCommonAlert>
        <UiCommonButton type="submit" variant="secondary" :is-loading="period.isPending.value">期間を保存</UiCommonButton>
      </form>
    </UiCommonCard>

    <UiCommonCard title="公開履歴" :is-flush="versions.length > 0">
      <p v-if="versions.length === 0" class="text-sm text-slate-500">まだ公開されていません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="version in versions" :key="version.version" class="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
          <span class="font-medium text-slate-900">バージョン {{ version.version }}</span>
          <UiCommonBadge v-if="version.version === survey.currentVersion" tone="success">現在の公開版</UiCommonBadge>
          <span class="text-slate-500">設問 {{ version.content.questions.length }} 問</span>
          <span class="ml-auto text-slate-500">{{ formatDateTime(version.publishedAt) }}</span>
        </li>
      </ul>
    </UiCommonCard>

    <UiCommonModal v-model="isConfirmOpen" :title="confirmAction === 'close' ? 'アンケートを終了しますか？' : 'URL を再発行しますか？'">
      <UiCommonAlert tone="warning">
        <template v-if="confirmAction === 'close'">終了すると回答の受付を再開できません。これまでの回答は残ります。</template>
        <template v-else>現在の URL と配布済みの QR コードは使えなくなります。新しい QR コードを配布し直してください。</template>
      </UiCommonAlert>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isConfirmOpen = false">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" @click="onConfirm">{{ confirmAction === 'close' ? '終了する' : '再発行する' }}</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
