<script setup lang="ts">
import type { Question, RedirectCondition } from '~/types/domain'

// F-07 遷移条件（どの回答なら Google 口コミ導線を出すか）

const editor = useInjectedSurveyEditor()
const { draft } = editor

const questions = computed(() => draft.value?.questions ?? [])
const conditions = computed(() => draft.value?.redirectRule.conditions ?? [])

const operatorOptions = [
  { value: 'and' as const, label: 'すべての条件を満たす' },
  { value: 'or' as const, label: 'いずれかの条件を満たす' },
]

const questionOptions = computed(() =>
  questions.value.map((question, index) => ({ value: question.id, label: `Q${index + 1}. ${question.label || '（無題の設問）'}` })))

function questionOf(condition: RedirectCondition): Question | undefined {
  return questions.value.find(question => question.id === condition.questionId)
}

function comparatorOptions(condition: RedirectCondition) {
  const type = questionOf(condition)?.type ?? 'rating'
  return COMPARATORS_BY_TYPE[type].map(comparator => ({ value: comparator, label: COMPARATOR_LABELS[comparator] }))
}

function valueOptions(condition: RedirectCondition): { value: string | number; label: string }[] {
  const question = questionOf(condition)
  if (!question) return []
  if (question.type === 'rating') return [1, 2, 3, 4, 5].map(value => ({ value, label: `★${value}` }))
  if (question.type === 'nps') return Array.from({ length: 11 }, (_, value) => ({ value, label: String(value) }))
  return question.options.map(option => ({ value: option.id, label: option.label }))
}

function onChangeQuestion(condition: RedirectCondition, questionId: string): void {
  editor.changeConditionQuestion(condition.id, questionId)
}
</script>

<template>
  <div v-if="draft" class="space-y-5">
    <UiCommonAlert tone="warning" title="Google のポリシーに関する注意">
      高評価の顧客だけに口コミを依頼する運用（レビューゲーティング）は Google のポリシーで禁止されています。
      口コミの削除やビジネスプロフィールの制限につながるおそれがあります。条件の使い方は運用前に必ずご確認ください。
    </UiCommonAlert>

    <div class="w-full sm:w-72">
      <UiInputSelectField v-model="draft.redirectRule.operator" label="条件の組み合わせ" :options="operatorOptions" />
    </div>

    <p v-if="conditions.length === 0" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      条件が 1 つもありません。公開するには条件を 1 つ以上設定してください。
    </p>

    <div
      v-for="(condition, index) in conditions"
      :key="condition.id"
      class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
    >
      <UiInputSelectField
        :model-value="condition.questionId"
        :label="`条件 ${index + 1}: 設問`"
        :options="questionOptions"
        @update:model-value="onChangeQuestion(condition, $event)"
      />
      <div v-if="condition.comparator !== 'notEmpty'" class="sm:w-32">
        <UiInputSelectField v-model="condition.value" label="値" :options="valueOptions(condition)" />
      </div>
      <div class="sm:w-36">
        <UiInputSelectField v-model="condition.comparator" label="比較" :options="comparatorOptions(condition)" />
      </div>
      <UiCommonButton variant="ghost" icon="trash" aria-label="条件を削除" @click="editor.removeCondition(condition.id)">
        <span class="sm:sr-only">削除</span>
      </UiCommonButton>
    </div>

    <UiCommonButton variant="secondary" icon="plus" :is-disabled="questions.length === 0" @click="editor.addCondition()">
      条件を追加
    </UiCommonButton>

    <p class="text-sm text-slate-500">
      条件を満たした回答者に、Google の口コミ投稿への案内を表示します。満たさない回答者にはお礼画面を表示します。
    </p>
  </div>
</template>
