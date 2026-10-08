<script setup lang="ts">
import type { QuestionType } from '~/types/domain'
import { OPTION_LIMIT, QUESTION_LIMIT, QUESTION_TYPE_LABELS } from '~/utils/surveyTemplates'

// F-06 設問ビルダー

const editor = useInjectedSurveyEditor()
const { draft, canAddQuestion, referencedQuestionIds } = editor

const newType = ref<QuestionType>('rating')
const deletingQuestionId = ref<string | null>(null)

const typeOptions = (Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map(type => ({ value: type, label: QUESTION_TYPE_LABELS[type] }))
const questions = computed(() => draft.value?.questions ?? [])
const deletingQuestion = computed(() => questions.value.find(question => question.id === deletingQuestionId.value) ?? null)
const isDeleteModalOpen = computed({
  get: () => deletingQuestionId.value !== null,
  set: (value: boolean) => { if (!value) deletingQuestionId.value = null },
})

function onRequestDelete(questionId: string): void {
  // 遷移条件で参照中の設問だけ確認を挟む
  if (referencedQuestionIds.value.has(questionId)) deletingQuestionId.value = questionId
  else editor.removeQuestion(questionId)
}

function onConfirmDelete(): void {
  if (deletingQuestionId.value) editor.removeQuestion(deletingQuestionId.value)
  deletingQuestionId.value = null
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="questions.length === 0" class="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      設問がありません。下のボタンから追加してください。
    </p>

    <article
      v-for="(question, index) in questions"
      :key="question.id"
      class="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <header class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold text-brand-700">Q{{ index + 1 }}</span>
        <UiCommonBadge>{{ QUESTION_TYPE_LABELS[question.type] }}</UiCommonBadge>
        <UiCommonBadge v-if="referencedQuestionIds.has(question.id)" tone="brand">遷移条件で使用中</UiCommonBadge>
        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="上へ移動"
            :disabled="index === 0"
            @click="editor.moveQuestion(question.id, -1)"
          >
            <UiCommonIcon name="chevron-up" size-class="size-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="下へ移動"
            :disabled="index === questions.length - 1"
            @click="editor.moveQuestion(question.id, 1)"
          >
            <UiCommonIcon name="chevron-down" size-class="size-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="複製"
            :disabled="!canAddQuestion"
            @click="editor.duplicateQuestion(question.id)"
          >
            <UiCommonIcon name="copy" size-class="size-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
            aria-label="削除"
            @click="onRequestDelete(question.id)"
          >
            <UiCommonIcon name="trash" size-class="size-4" />
          </button>
        </div>
      </header>

      <UiInputTextField v-model="question.label" label="設問文" :maxlength="100" is-required :error="question.label.trim() ? null : '設問文を入力してください'" />

      <div v-if="question.type === 'single' || question.type === 'multi'" class="space-y-2">
        <p class="text-sm font-medium text-slate-700">選択肢</p>
        <div v-for="(option, optionIndex) in question.options" :key="option.id" class="flex items-center gap-2">
          <input
            v-model="option.label"
            type="text"
            :aria-label="`選択肢 ${optionIndex + 1}`"
            maxlength="40"
            class="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:outline-2 focus:outline-brand-500"
          >
          <button
            type="button"
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="選択肢を削除"
            :disabled="question.options.length <= 2"
            @click="editor.removeOption(question.id, option.id)"
          >
            <UiCommonIcon name="x" size-class="size-4" />
          </button>
        </div>
        <UiCommonButton
          variant="ghost"
          size="sm"
          icon="plus"
          :is-disabled="question.options.length >= OPTION_LIMIT"
          @click="editor.addOption(question.id)"
        >
          選択肢を追加（{{ question.options.length }} / {{ OPTION_LIMIT }}）
        </UiCommonButton>
      </div>

      <!-- 口コミ下書きの材料（useForReviewDraft）は文面の生成を作らないため表示しない。値は保存時にそのまま残る -->
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <UiInputCheckboxField v-model="question.isRequired" label="必須にする" />
      </div>
    </article>

    <div class="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div class="w-full sm:w-56">
        <UiInputSelectField v-model="newType" label="追加する設問のタイプ" :options="typeOptions" />
      </div>
      <UiCommonButton icon="plus" :is-disabled="!canAddQuestion" @click="editor.addQuestion(newType)">設問を追加</UiCommonButton>
      <p class="w-full text-xs text-slate-500">設問は {{ QUESTION_LIMIT }} 問まで（現在 {{ questions.length }} 問）</p>
    </div>

    <UiCommonModal v-model="isDeleteModalOpen" title="設問を削除しますか？">
      <UiCommonAlert tone="warning">
        「{{ deletingQuestion?.label || '無題の設問' }}」は遷移条件で使われています。削除すると、この設問を参照する条件もあわせて削除されます。
      </UiCommonAlert>
      <template #footer>
        <UiCommonButton variant="secondary" @click="isDeleteModalOpen = false">キャンセル</UiCommonButton>
        <UiCommonButton variant="danger" @click="onConfirmDelete">削除する</UiCommonButton>
      </template>
    </UiCommonModal>
  </div>
</template>
