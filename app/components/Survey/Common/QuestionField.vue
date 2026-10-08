<script setup lang="ts">
import type { AnswerValue, Question } from '~/types/domain'

// 設問タイプに応じた入力部品を出し分ける。回答画面と管理画面のプレビューで共用する。

interface Props {
  question: Question
  /** 1 から始まる設問番号 */
  number: number
  error?: string | null
}

withDefaults(defineProps<Props>(), { error: null })

const model = defineModel<AnswerValue | undefined>({ required: true })

// 各入力部品の型に合わせて受け渡す
const numberValue = computed({
  get: () => (typeof model.value === 'number' ? model.value : undefined),
  set: (value: number | undefined) => { model.value = value },
})
const choiceValue = computed({
  get: () => (typeof model.value === 'number' ? undefined : model.value),
  set: (value: string | string[] | undefined) => { model.value = value },
})
const textValue = computed({
  get: () => (typeof model.value === 'string' ? model.value : undefined),
  set: (value: string | undefined) => { model.value = value },
})
</script>

<template>
  <fieldset class="space-y-3 rounded-xl border bg-white p-4" :class="error ? 'border-rose-300' : 'border-slate-200'">
    <legend class="sr-only">{{ question.label }}</legend>
    <p class="text-base font-medium text-slate-900">
      <span class="mr-1 text-brand-600">Q{{ number }}.</span>
      {{ question.label || '（設問文が未入力です）' }}
      <span v-if="question.isRequired" class="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-normal text-rose-700">必須</span>
    </p>
    <SurveyInputRatingInput v-if="question.type === 'rating'" v-model="numberValue" :label="question.label" />
    <SurveyInputNpsInput v-else-if="question.type === 'nps'" v-model="numberValue" :label="question.label" />
    <SurveyInputChoiceInput
      v-else-if="question.type === 'single' || question.type === 'multi'"
      v-model="choiceValue"
      :label="question.label"
      :options="question.options"
      :is-multiple="question.type === 'multi'"
    />
    <SurveyInputTextAnswerInput v-else v-model="textValue" :label="question.label" />
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </fieldset>
</template>
