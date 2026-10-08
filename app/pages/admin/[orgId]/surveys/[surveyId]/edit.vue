<script setup lang="ts">
definePageMeta({ layout: 'admin' })

// F-06・F-07 アンケート編集（設問 / 遷移条件 / デザイン）。
// 口コミ文面の生成設定とテスト生成は、文面の生成を作らないため表示しない（値は保存時にそのまま残る）

type EditorTab = 'questions' | 'rule' | 'design'

const route = useRoute()
const surveyId = String(route.params.surveyId)
const { adminPath, storeName } = useCurrentOrg()
const { findSurvey } = useSurveys()
const visibleSurvey = findSurvey(surveyId)

const editor = useSurveyEditor(surveyId)
provide(SURVEY_EDITOR_KEY, editor)
const { draft, title, saveState, saveError, isEditable } = editor

useHead({ title: () => `編集: ${title.value || 'アンケート'}` })

const TABS: { value: EditorTab; label: string }[] = [
  { value: 'questions', label: '設問' },
  { value: 'rule', label: '遷移条件' },
  { value: 'design', label: 'デザイン' },
]
const activeTab = ref<EditorTab>('questions')

const SAVE_STATE_LABELS = { saved: '保存済み', unsaved: '未保存の変更あり', saving: '保存中…', error: '保存に失敗しました' } as const
</script>

<template>
  <div v-if="!visibleSurvey || !draft" class="space-y-4">
    <UiCommonPageHeader title="アンケートが見つかりません" :back-to="adminPath('/surveys')" back-label="アンケート一覧" />
    <UiCommonAlert tone="warning">削除されたか、閲覧権限のないアンケートです。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader
      title="アンケートを編集"
      :description="storeName(visibleSurvey.storeId)"
      :back-to="adminPath(`/surveys/${surveyId}`)"
      back-label="公開管理へ"
    >
      <template #badge>
        <AdminCommonSurveyStatusBadge :status="visibleSurvey.status" />
      </template>
      <template #actions>
        <span
          class="inline-flex items-center gap-1.5 text-sm"
          :class="saveState === 'saved' ? 'text-emerald-700' : saveState === 'error' ? 'text-rose-700' : 'text-slate-500'"
          aria-live="polite"
        >
          <UiCommonIcon v-if="saveState === 'saved'" name="check" size-class="size-4" />
          {{ SAVE_STATE_LABELS[saveState] }}
        </span>
        <UiCommonButton variant="secondary" :to="adminPath(`/surveys/${surveyId}`)">公開管理へ</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert v-if="saveState === 'error' && saveError" tone="danger" title="保存に失敗しました">
      {{ saveError }} 次に編集したとき、またはこの画面を離れるときにもう一度保存します。
    </UiCommonAlert>
    <UiCommonAlert v-if="!isEditable" tone="info" title="終了したアンケートです">
      終了したアンケートは編集できません。内容を再利用する場合は、一覧から複製してください。
    </UiCommonAlert>
    <UiCommonAlert v-else-if="visibleSurvey.status !== 'draft'" tone="info">
      編集内容は自動保存されますが、回答画面に反映するには公開管理画面で「変更を公開」を押してください。
    </UiCommonAlert>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <fieldset :disabled="!isEditable" class="min-w-0 space-y-5">
        <UiInputTextField v-model="title" label="管理用のタイトル" :maxlength="60" hint="回答者には表示されません" />

        <div role="tablist" aria-label="編集項目" class="flex gap-1 overflow-x-auto border-b border-slate-200">
          <button
            v-for="tab in TABS"
            :key="tab.value"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.value"
            class="-mb-px border-b-2 px-4 py-2.5 text-sm whitespace-nowrap"
            :class="activeTab === tab.value ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
            <span v-if="tab.value === 'rule' && draft.redirectRule.conditions.length === 0" class="ml-1 text-rose-600" aria-label="要設定">●</span>
          </button>
        </div>

        <div role="tabpanel">
          <SurveyEditorEditQuestionList v-if="activeTab === 'questions'" />
          <SurveyEditorEditRuleBuilder v-else-if="activeTab === 'rule'" />
          <SurveyEditorEditDesignSettings v-else />
        </div>
      </fieldset>

      <aside class="hidden lg:block">
        <div class="sticky top-20 space-y-2">
          <p class="text-center text-xs font-medium text-slate-500">回答画面のプレビュー</p>
          <SurveyEditorEditPhonePreview :content="draft" :store-name="storeName(visibleSurvey.storeId)" />
        </div>
      </aside>
    </div>
  </div>
</template>
