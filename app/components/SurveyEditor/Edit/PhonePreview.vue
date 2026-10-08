<script setup lang="ts">
import type { Answers, SurveyContent } from '~/types/domain'

// 回答画面のスマホ表示プレビュー。入力しても保存されない。

interface Props {
  content: SurveyContent
  storeName: string
}

defineProps<Props>()

const answers = ref<Answers>({})
</script>

<template>
  <div class="mx-auto w-full max-w-[340px] rounded-[2.2rem] border-8 border-slate-800 bg-slate-800 shadow-xl">
    <div class="h-[640px] overflow-y-auto rounded-[1.6rem] bg-slate-50 px-3 py-5">
      <div class="mb-4 space-y-2 text-center">
        <p class="text-xs text-slate-500">{{ storeName }}</p>
        <p class="text-sm leading-relaxed text-slate-700">{{ content.design.intro }}</p>
      </div>
      <div class="space-y-3">
        <SurveyCommonQuestionField
          v-for="(question, index) in content.questions"
          :key="question.id"
          v-model="answers[question.id]"
          :question="question"
          :number="index + 1"
        />
      </div>
      <div class="mt-4 rounded-lg bg-brand-600 py-3 text-center text-sm font-medium text-white">送信する</div>
      <p class="mt-3 text-center text-[11px] text-slate-400">プレビューのため送信されません</p>
    </div>
  </div>
</template>
