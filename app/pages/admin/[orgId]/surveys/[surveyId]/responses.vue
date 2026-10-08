<script setup lang="ts">
import type { SurveyResponse } from '~/types/domain'

definePageMeta({ layout: 'admin' })

// F-14 回答一覧・集計・CSV

const route = useRoute()
const surveyId = String(route.params.surveyId)
const { adminPath, storeName } = useCurrentOrg()
const { findSurvey } = useSurveys()
const survey = findSurvey(surveyId)
const { filters, page, pageCount, filteredResponses, pagedResponses, questions, isWindowed, downloadCsv } = useResponses(surveyId)
const { summary, questionStats } = useResponseStats(filteredResponses, questions)
const csv = useActionState()

useHead({ title: () => `回答: ${survey.value?.title ?? 'アンケート'}` })

const periodOptions = [
  { value: 7, label: '直近 7 日' },
  { value: 30, label: '直近 30 日' },
  { value: 90, label: '直近 90 日' },
  { value: null, label: '全期間' },
]
const eligibilityOptions = [
  { value: 'all' as const, label: '条件: すべて' },
  { value: 'eligible' as const, label: '条件を満たす' },
  { value: 'not-eligible' as const, label: '条件を満たさない' },
]
const redirectOptions = [
  { value: 'all' as const, label: '遷移: すべて' },
  { value: 'redirected' as const, label: 'Google へ遷移あり' },
  { value: 'not-redirected' as const, label: 'Google へ遷移なし' },
]

/** 一覧の「概要」列に出す設問（最初の星評価） */
const ratingQuestion = computed(() => questions.value.find(question => question.type === 'rating') ?? null)
const commentQuestion = computed(() => questions.value.find(question => question.type === 'text') ?? null)

const selectedResponse = ref<SurveyResponse | null>(null)
const isDetailOpen = computed({
  get: () => selectedResponse.value !== null,
  set: (value: boolean) => { if (!value) selectedResponse.value = null },
})

function maxCount(counts: { count: number }[]): number {
  return Math.max(1, ...counts.map(item => item.count))
}

async function onDownloadCsv(): Promise<void> {
  await csv.run(downloadCsv)
}
</script>

<template>
  <div v-if="!survey" class="space-y-4">
    <UiCommonPageHeader title="アンケートが見つかりません" :back-to="adminPath('/surveys')" back-label="アンケート一覧" />
    <UiCommonAlert tone="warning">削除されたか、閲覧権限のないアンケートです。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader
      :title="`回答: ${survey.title}`"
      :description="storeName(survey.storeId)"
      :back-to="adminPath(`/surveys/${surveyId}`)"
      back-label="公開管理へ"
    >
      <template #actions>
        <UiCommonButton variant="secondary" icon="download" :is-loading="csv.isPending.value" :is-disabled="!isWindowed && filteredResponses.length === 0" @click="onDownloadCsv">
          CSV をダウンロード
        </UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert v-if="csv.errorMessage.value" tone="danger">{{ csv.errorMessage.value }}</UiCommonAlert>
    <UiCommonAlert v-if="isWindowed" tone="info">{{ RESPONSE_WINDOW_NOTICE }}</UiCommonAlert>
    <p v-if="isWindowed" class="text-xs text-slate-500">CSV は期間だけで絞り込みます（画面の絞り込み条件は反映されません）</p>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="w-full"><UiInputSelectField v-model="filters.days" label="期間" :options="periodOptions" is-label-hidden /></div>
      <div class="w-full"><UiInputSelectField v-model="filters.eligibility" label="条件合致" :options="eligibilityOptions" is-label-hidden /></div>
      <div class="w-full"><UiInputSelectField v-model="filters.redirect" label="Google 遷移" :options="redirectOptions" is-label-hidden /></div>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <UiCommonStatCard label="回答数" :value="summary.total" sub="件" />
      <UiCommonStatCard label="条件合致率" :value="formatPercent(summary.eligible, summary.total)" :sub="`${summary.eligible} 件`" />
      <UiCommonStatCard label="Google 遷移率" :value="formatPercent(summary.redirected, summary.eligible)" :sub="`条件合致 ${summary.eligible} 件中 ${summary.redirected} 件`" />
    </div>

    <UiCommonCard title="設問ごとの集計" description="絞り込み条件に合う回答で集計しています">
      <p v-if="questionStats.length === 0" class="text-sm text-slate-500">公開済みの設問がありません。</p>
      <div v-else class="grid gap-6 md:grid-cols-2">
        <section v-for="stat in questionStats" :key="stat.question.id" class="space-y-3">
          <div>
            <h3 class="text-sm font-medium text-slate-900">{{ stat.question.label }}</h3>
            <p class="text-xs text-slate-500">
              回答 {{ stat.answeredCount }} 件
              <template v-if="stat.average !== null"> ・ 平均 {{ stat.average }}</template>
            </p>
          </div>
          <ul v-if="stat.distribution.length > 0" class="space-y-1.5">
            <li v-for="item in stat.distribution" :key="item.key" class="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm">
              <span class="truncate text-slate-600">{{ item.label }}</span>
              <span class="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <span class="block h-full rounded-full bg-brand-500" :style="{ width: `${(item.count / maxCount(stat.distribution)) * 100}%` }" />
              </span>
              <span class="text-right text-slate-700 tabular-nums">{{ item.count }}</span>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-500">自由記述は下の一覧から確認できます。</p>
        </section>
      </div>
    </UiCommonCard>

    <UiCommonCard title="回答一覧" is-flush>
      <p v-if="filteredResponses.length === 0" class="p-5 text-sm text-slate-500">条件に合う回答はありません。</p>
      <template v-else>
        <div class="relative overflow-x-auto">
          <table class="w-full min-w-[640px] text-sm">
            <thead class="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th class="px-5 py-2.5 font-medium">回答日時</th>
                <th class="px-3 py-2.5 font-medium">総合評価</th>
                <th class="px-3 py-2.5 font-medium">ご感想</th>
                <th class="px-3 py-2.5 font-medium">条件</th>
                <th class="px-3 py-2.5 font-medium">Google 遷移</th>
                <th class="px-5 py-2.5"><span class="sr-only">詳細</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="response in pagedResponses" :key="response.id" class="hover:bg-slate-50">
                <td class="px-5 py-3 whitespace-nowrap text-slate-600 tabular-nums">{{ formatDateTime(response.createdAt) }}</td>
                <td class="px-3 py-3 whitespace-nowrap">{{ ratingQuestion ? formatAnswer(ratingQuestion, response) : '—' }}</td>
                <td class="max-w-64 truncate px-3 py-3 text-slate-600">{{ commentQuestion ? formatAnswer(commentQuestion, response) : '—' }}</td>
                <td class="px-3 py-3">
                  <UiCommonBadge :tone="response.isEligible ? 'success' : 'neutral'">{{ response.isEligible ? '合致' : '非合致' }}</UiCommonBadge>
                </td>
                <td class="px-3 py-3 whitespace-nowrap text-slate-600">{{ response.redirectedAt ? formatDateTime(response.redirectedAt) : '—' }}</td>
                <td class="px-5 py-3 text-right">
                  <UiCommonButton variant="ghost" size="sm" @click="selectedResponse = response">詳細</UiCommonButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav class="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm" aria-label="ページ送り">
          <span class="text-slate-500 tabular-nums">{{ filteredResponses.length }} 件中 {{ (page - 1) * PAGE_SIZE + 1 }}〜{{ Math.min(page * PAGE_SIZE, filteredResponses.length) }} 件</span>
          <div class="flex items-center gap-2">
            <UiCommonButton variant="secondary" size="sm" icon="chevron-left" :is-disabled="page <= 1" @click="page--">前へ</UiCommonButton>
            <span class="text-slate-600 tabular-nums">{{ page }} / {{ pageCount }}</span>
            <UiCommonButton variant="secondary" size="sm" :is-disabled="page >= pageCount" @click="page++">次へ</UiCommonButton>
          </div>
        </nav>
      </template>
    </UiCommonCard>

    <UiCommonModal v-model="isDetailOpen" title="回答の詳細" size="lg">
      <div v-if="selectedResponse" class="space-y-5">
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt class="text-xs text-slate-500">回答日時</dt><dd class="tabular-nums">{{ formatDateTime(selectedResponse.createdAt) }}</dd></div>
          <div><dt class="text-xs text-slate-500">バージョン</dt><dd>{{ selectedResponse.surveyVersion }}</dd></div>
          <div><dt class="text-xs text-slate-500">遷移条件</dt><dd>{{ selectedResponse.isEligible ? '満たす' : '満たさない' }}</dd></div>
          <div><dt class="text-xs text-slate-500">Google 遷移</dt><dd class="tabular-nums">{{ formatDateTime(selectedResponse.redirectedAt) }}</dd></div>
        </dl>
        <dl class="divide-y divide-slate-100 rounded-lg border border-slate-200">
          <div v-for="question in questions" :key="question.id" class="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[14rem_1fr]">
            <dt class="text-slate-500">{{ question.label }}</dt>
            <dd class="whitespace-pre-wrap text-slate-900">{{ formatAnswer(question, selectedResponse) }}</dd>
          </div>
        </dl>
      </div>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isDetailOpen = false">閉じる</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
