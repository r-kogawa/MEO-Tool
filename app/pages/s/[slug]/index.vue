<script setup lang="ts">
import type { AnswerValue, Answers } from '~/types/domain'

definePageMeta({ layout: 'survey' })
useSeoMeta({ title: 'アンケート', robots: 'noindex, nofollow' })

const route = useRoute()
const slug = String(route.params.slug)
const { snapshot, availability, submit } = usePublicSurvey(slug)
const { isPending, errorMessage, run } = useActionState()

const answers = ref<Record<string, AnswerValue | undefined>>({})
const questionErrors = ref<Record<string, string>>({})

const UNAVAILABLE_MESSAGES = {
  'not-found': 'アンケートが見つかりません。URL をご確認ください。',
  'paused': '現在このアンケートは受け付けていません。',
  'out-of-period': '回答の受付期間外です。',
} as const

/** 受け付けていないときの文言（読み込み中は使わない） */
const unavailableMessage = computed(() => {
  const key = availability.value
  return key === 'available' || key === 'loading' ? UNAVAILABLE_MESSAGES['not-found'] : UNAVAILABLE_MESSAGES[key]
})

function isEmpty(value: AnswerValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

function validate(): boolean {
  const errors: Record<string, string> = {}
  for (const question of snapshot.value?.questions ?? []) {
    if (question.isRequired && isEmpty(answers.value[question.id])) errors[question.id] = 'この設問は必須です。'
  }
  questionErrors.value = errors
  return Object.keys(errors).length === 0
}

async function onSubmit(): Promise<void> {
  if (!validate()) {
    const firstId = snapshot.value?.questions.find(question => questionErrors.value[question.id])?.id
    if (firstId) document.getElementById(`question-${firstId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }
  const cleaned: Answers = {}
  for (const [id, value] of Object.entries(answers.value)) {
    if (!isEmpty(value)) cleaned[id] = value as AnswerValue
  }
  const result = await run(() => submit(cleaned))
  if (!result) return
  await navigateTo(result.isEligible ? `/s/${slug}/review` : `/s/${slug}/thanks`)
}

// 回答し直した設問のエラーは消す
watch(answers, (value) => {
  for (const id of Object.keys(questionErrors.value)) {
    if (!isEmpty(value[id])) delete questionErrors.value[id]
  }
}, { deep: true })
</script>

<template>
  <div v-if="availability === 'loading'" class="py-10 text-center text-sm text-slate-500" role="status">
    読み込み中…
  </div>

  <div v-else-if="availability !== 'available' || !snapshot" class="space-y-4 py-10 text-center">
    <p v-if="snapshot" class="text-sm text-slate-500">{{ snapshot.storeName }}</p>
    <UiCommonAlert tone="warning">{{ unavailableMessage }}</UiCommonAlert>
  </div>

  <form v-else class="space-y-5" novalidate @submit.prevent="onSubmit">
    <header class="space-y-2 text-center">
      <p class="text-sm font-medium text-brand-700">{{ snapshot.storeName }}</p>
      <h1 class="text-xl font-bold text-slate-900">ご来店アンケート</h1>
      <p class="text-sm leading-relaxed text-slate-600">{{ snapshot.design.intro }}</p>
    </header>

    <div v-for="(question, index) in snapshot.questions" :id="`question-${question.id}`" :key="question.id">
      <SurveyCommonQuestionField
        v-model="answers[question.id]"
        :question="question"
        :number="index + 1"
        :error="questionErrors[question.id]"
      />
    </div>

    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>

    <UiCommonButton type="submit" is-block :is-loading="isPending">回答を送信する</UiCommonButton>
    <p class="text-center text-xs text-slate-400">
      ご回答の内容は店舗のサービス向上のために利用します。
    </p>
  </form>
</template>
