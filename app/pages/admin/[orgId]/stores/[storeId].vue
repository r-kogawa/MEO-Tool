<script setup lang="ts">
// F-05 店舗詳細。口コミ URL の確認と、紐づくアンケート・キーワードの一覧

definePageMeta({ layout: 'admin' })

const route = useRoute()
const storeId = String(route.params.storeId)
const { canManage, canAccessStore, adminPath } = useCurrentOrg()
const { findStore, archiveStore } = useStores()
const { surveys, responseCount, responseCountNote } = useSurveys()
const { rows: keywordRows } = useRankKeywords()
const { show } = useToast()

const store = findStore(storeId)
const isVisible = computed(() => store.value !== null && canAccessStore(storeId))
useHead({ title: () => store.value?.name ?? '店舗' })

const storeSurveys = computed(() => surveys.value.filter(survey => survey.storeId === storeId))
const storeKeywords = computed(() => keywordRows.value.filter(row => row.keyword.storeId === storeId))
const publishedCount = computed(() => storeSurveys.value.filter(survey => survey.status === 'published').length)

const isArchiveOpen = ref(false)
const archiveState = useActionState()

async function onArchive(): Promise<void> {
  await archiveState.run(() => archiveStore(storeId))
  if (archiveState.errorMessage.value) return
  isArchiveOpen.value = false
  show('店舗をアーカイブしました')
  await navigateTo(adminPath('/stores'))
}
</script>

<template>
  <div v-if="!isVisible || !store" class="space-y-4">
    <UiCommonPageHeader title="店舗が見つかりません" :back-to="adminPath('/stores')" back-label="店舗一覧へ" />
    <UiCommonAlert tone="warning">この店舗は存在しないか、閲覧する権限がありません。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader :title="store.name" :description="store.address" :back-to="adminPath('/stores')" back-label="店舗一覧へ">
      <template #badge>
        <UiCommonBadge v-if="store.status === 'archived'">アーカイブ済み</UiCommonBadge>
      </template>
      <template v-if="canManage && store.status === 'active'" #actions>
        <UiCommonButton variant="secondary" size="sm" icon="trash" @click="isArchiveOpen = true">アーカイブ</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiCommonCard title="基本情報" description="Google ビジネスプロフィールから取得した情報です">
        <dl class="space-y-3 text-sm">
          <div class="grid grid-cols-[7rem_1fr] gap-2">
            <dt class="text-slate-500">店舗名</dt>
            <dd class="font-medium">{{ store.name }}</dd>
          </div>
          <div class="grid grid-cols-[7rem_1fr] gap-2">
            <dt class="text-slate-500">住所</dt>
            <dd>{{ store.address }}</dd>
          </div>
          <div class="grid grid-cols-[7rem_1fr] gap-2">
            <dt class="text-slate-500">位置</dt>
            <dd class="tabular-nums">{{ store.lat.toFixed(4) }}, {{ store.lng.toFixed(4) }}</dd>
          </div>
          <div class="grid grid-cols-[7rem_1fr] gap-2">
            <dt class="text-slate-500">GBP ロケーション</dt>
            <dd class="break-all text-slate-600">{{ store.gbpLocationName ?? '手動登録' }}</dd>
          </div>
          <div class="grid grid-cols-[7rem_1fr] gap-2">
            <dt class="text-slate-500">Place ID</dt>
            <dd class="break-all text-slate-600">{{ store.placeId }}</dd>
          </div>
        </dl>
      </UiCommonCard>

      <UiCommonCard title="Google 口コミ URL" description="条件を満たした回答者はこの URL へ遷移します">
        <div class="space-y-3">
          <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs break-all text-slate-700">{{ store.reviewUrl }}</p>
          <div class="flex flex-wrap gap-2">
            <UiCommonButton variant="secondary" size="sm" icon="copy" @click="copyToClipboard(store.reviewUrl, '口コミ URL をコピーしました')">
              コピー
            </UiCommonButton>
            <a
              :href="store.reviewUrl"
              target="_blank"
              rel="noopener"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <UiCommonIcon name="external" size-class="size-4" />口コミ画面を開いて確認
            </a>
          </div>
          <p class="text-xs text-slate-500">デモ版の Place ID は仮の値のため、Google 側では店舗が表示されません。</p>
        </div>
      </UiCommonCard>
    </div>

    <UiCommonCard title="アンケート" :description="`${storeSurveys.length} 件`" is-flush>
      <template #actions>
        <UiCommonButton size="sm" variant="secondary" icon="plus" :to="adminPath('/surveys/new')">新規作成</UiCommonButton>
      </template>
      <p v-if="storeSurveys.length === 0" class="p-5 text-sm text-slate-500">この店舗のアンケートはまだありません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="survey in storeSurveys" :key="survey.id">
          <NuxtLink :to="adminPath(`/surveys/${survey.id}`)" class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ survey.title }}</span>
            <span class="text-xs text-slate-500 tabular-nums">回答 {{ responseCount(survey.id) }} 件{{ responseCountNote ? `（${responseCountNote}）` : '' }}</span>
            <AdminCommonSurveyStatusBadge :status="survey.status" />
          </NuxtLink>
        </li>
      </ul>
    </UiCommonCard>

    <UiCommonCard title="順位計測キーワード" :description="`${storeKeywords.length} 件`" is-flush>
      <template #actions>
        <NuxtLink :to="adminPath('/rankings')" class="text-sm text-brand-700 hover:underline">順位一覧へ</NuxtLink>
      </template>
      <p v-if="storeKeywords.length === 0" class="p-5 text-sm text-slate-500">この店舗のキーワードはまだありません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="row in storeKeywords" :key="row.keyword.id">
          <NuxtLink :to="adminPath(`/rankings/${row.keyword.id}`)" class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ row.keyword.keyword }}</span>
            <UiCommonBadge v-if="!row.keyword.isActive">停止中</UiCommonBadge>
            <span class="text-sm font-semibold tabular-nums">{{ row.latest?.rank == null ? '圏外' : `${row.latest?.rank}位` }}</span>
            <RankingCommonRankDiff :diff="row.dayDiff" label="前日比" />
          </NuxtLink>
        </li>
      </ul>
    </UiCommonCard>

    <UiCommonModal v-model="isArchiveOpen" title="店舗をアーカイブしますか？">
      <div class="space-y-3 text-sm text-slate-700">
        <p>「{{ store.name }}」をアーカイブします。アーカイブ後は一覧に表示されず、新しいアンケートも作成できません。</p>
        <UiCommonAlert v-if="publishedCount > 0" tone="warning">
          公開中のアンケート {{ publishedCount }} 件は一時停止になり、回答を受け付けなくなります。
        </UiCommonAlert>
        <p class="text-slate-500">回答や順位の履歴は残ります。</p>
        <UiCommonAlert v-if="archiveState.errorMessage.value" tone="danger">{{ archiveState.errorMessage.value }}</UiCommonAlert>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isArchiveOpen = false">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" :is-loading="archiveState.isPending.value" @click="onArchive">アーカイブする</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
