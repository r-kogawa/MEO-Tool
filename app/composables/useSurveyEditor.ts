import type { InjectionKey } from 'vue'
import type { Comparator, QuestionType, RedirectCondition, Survey, SurveyContent } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { errorMessageOf } from '~/utils/mock/functions/shared'
import { cloneData } from '~/utils/cloneData'
import { OPTION_LIMIT, QUESTION_LIMIT, createQuestion } from '~/utils/surveyTemplates'

// F-06・F-07 アンケートの下書き編集。
// 入力が止まってから一定時間後に自動保存する。本物モードは updateSurveyDraft（Functions）で保存する。
// 口コミ文面の生成設定（reviewDraftSettings）は画面に出さないが、値は下書きと一緒にそのまま保存する。

const AUTOSAVE_DELAY_MS = 800

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  eq: 'と等しい',
  neq: 'と等しくない',
  gte: '以上',
  lte: '以下',
  includes: 'を含む',
  notIncludes: 'を含まない',
  notEmpty: '回答がある',
}

/** 設問タイプごとに使える比較子 */
export const COMPARATORS_BY_TYPE: Record<QuestionType, Comparator[]> = {
  rating: ['gte', 'lte', 'eq', 'neq'],
  nps: ['gte', 'lte', 'eq', 'neq'],
  single: ['eq', 'neq'],
  multi: ['includes', 'notIncludes'],
  text: ['notEmpty'],
}

export function useSurveyEditor(surveyId: string) {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const survey = computed(() => db.value.surveys.find(item => item.id === surveyId) ?? null)

  const draft = ref<SurveyContent | null>(null)
  const title = ref('')
  const saveState = ref<SaveState>('saved')
  const saveError = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 読み込みで draft / title を入れた直後の変更通知は、自動保存しない */
  let isLoading = false
  /** 編集の回数。保存中に編集されたら、保存が終わっても「未保存」のままにする */
  let revision = 0
  /** 本物モードの保存を 1 件ずつ順番に送るための印（古い内容が新しい内容を上書きしないようにする） */
  let isSaving = false
  let isSavePending = false

  function saveToMock(target: Survey, content: SurveyContent): void {
    target.draft = cloneData(content)
    target.title = title.value.trim() || target.title
    target.hasUnpublishedChanges = target.currentVersion !== null
    target.updatedAt = new Date().toISOString()
  }

  /** 保存中に呼ばれたら「保存待ち」の印だけ立て、完了後にその時点の最新の内容でもう一度保存する */
  async function saveToServer(): Promise<void> {
    if (isSaving) {
      isSavePending = true
      return
    }
    isSaving = true
    try {
      let sentRevision: number
      do {
        const target = survey.value
        if (!target || !draft.value) return
        isSavePending = false
        sentRevision = revision
        saveState.value = 'saving'
        saveError.value = null
        await callFunction($functions, 'updateSurveyDraft', {
          orgId: target.orgId,
          surveyId,
          title: title.value.trim() || target.title,
          draft: cloneData(draft.value),
        })
      } while (isSavePending)
      // 送信後にも編集されていれば、自動保存のタイマーが次の保存を送る
      if (revision === sentRevision) saveState.value = 'saved'
    }
    catch (error) {
      // 次の編集、または画面を離れるときに再び保存する
      isSavePending = false
      saveState.value = 'error'
      saveError.value = errorMessageOf(error)
    }
    finally {
      isSaving = false
    }
  }

  async function save(): Promise<void> {
    if (!isMock) return saveToServer()
    const target = survey.value
    if (!target || !draft.value) return
    saveToMock(target, draft.value)
    saveState.value = 'saved'
  }

  watch([draft, title], () => {
    if (isLoading) {
      isLoading = false
      return
    }
    revision++
    saveState.value = 'unsaved'
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!isMock) {
        void save()
        return
      }
      saveState.value = 'saving'
      setTimeout(save, 200)
    }, AUTOSAVE_DELAY_MS)
  }, { deep: true })

  // 本物モードでは購読が届いてから下書きを読み込む（作成直後や再読み込み直後は、まだ届いていない）。
  // 一度読み込んだ後は、購読の更新で編集中の内容を上書きしない
  watch(survey, (value) => {
    if (!value || draft.value) return
    isLoading = true
    draft.value = cloneData(value.draft)
    title.value = value.title
  }, { immediate: true })

  onBeforeUnmount(() => {
    // 画面を離れるときは待たずに保存する
    if (saveState.value === 'unsaved' || saveState.value === 'error') void save()
    clearTimeout(timer)
  })

  const isEditable = computed(() => survey.value?.status !== 'closed')
  const canAddQuestion = computed(() => (draft.value?.questions.length ?? 0) < QUESTION_LIMIT)

  /** 遷移条件から参照されている設問 ID */
  const referencedQuestionIds = computed(() =>
    new Set(draft.value?.redirectRule.conditions.map(condition => condition.questionId) ?? []))

  function addQuestion(type: QuestionType): void {
    if (!draft.value || !canAddQuestion.value) return
    draft.value.questions.push(createQuestion(type))
  }

  function removeQuestion(questionId: string): void {
    if (!draft.value) return
    draft.value.questions = draft.value.questions.filter(question => question.id !== questionId)
    // 削除した設問を参照する条件も外す
    draft.value.redirectRule.conditions = draft.value.redirectRule.conditions.filter(condition => condition.questionId !== questionId)
  }

  function duplicateQuestion(questionId: string): void {
    if (!draft.value || !canAddQuestion.value) return
    const index = draft.value.questions.findIndex(question => question.id === questionId)
    const source = draft.value.questions[index]
    if (!source) return
    const copy = { ...cloneData(source), id: createQuestion(source.type).id }
    copy.options = copy.options.map(option => ({ ...option, id: `o-${crypto.randomUUID().slice(0, 8)}` }))
    draft.value.questions.splice(index + 1, 0, copy)
  }

  function moveQuestion(questionId: string, direction: -1 | 1): void {
    if (!draft.value) return
    const questions = draft.value.questions
    const index = questions.findIndex(question => question.id === questionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= questions.length) return
    ;[questions[index], questions[target]] = [questions[target]!, questions[index]!]
  }

  function addOption(questionId: string): void {
    const question = draft.value?.questions.find(item => item.id === questionId)
    if (!question || question.options.length >= OPTION_LIMIT) return
    question.options.push({ id: `o-${crypto.randomUUID().slice(0, 8)}`, label: `選択肢 ${question.options.length + 1}` })
  }

  function removeOption(questionId: string, optionId: string): void {
    const question = draft.value?.questions.find(item => item.id === questionId)
    if (!question || question.options.length <= 2) return
    question.options = question.options.filter(option => option.id !== optionId)
  }

  function defaultConditionFor(questionId: string): RedirectCondition {
    const question = draft.value?.questions.find(item => item.id === questionId)
    const comparator = COMPARATORS_BY_TYPE[question?.type ?? 'rating'][0]!
    const value = question?.type === 'rating' ? 4 : question?.type === 'nps' ? 9 : question?.options[0]?.id ?? null
    return { id: `c-${crypto.randomUUID().slice(0, 8)}`, questionId, comparator, value: comparator === 'notEmpty' ? null : value }
  }

  function addCondition(): void {
    const first = draft.value?.questions[0]
    if (!draft.value || !first) return
    draft.value.redirectRule.conditions.push(defaultConditionFor(first.id))
  }

  /** 条件の設問を変えたら、比較子と値をその設問タイプの既定値に戻す */
  function changeConditionQuestion(conditionId: string, questionId: string): void {
    const conditions = draft.value?.redirectRule.conditions
    const index = conditions?.findIndex(condition => condition.id === conditionId) ?? -1
    if (!conditions || index < 0) return
    conditions.splice(index, 1, { ...defaultConditionFor(questionId), id: conditionId })
  }

  function removeCondition(conditionId: string): void {
    if (!draft.value) return
    draft.value.redirectRule.conditions = draft.value.redirectRule.conditions.filter(condition => condition.id !== conditionId)
  }

  return {
    survey,
    draft,
    title,
    saveState,
    saveError,
    isEditable,
    canAddQuestion,
    referencedQuestionIds,
    addQuestion,
    removeQuestion,
    duplicateQuestion,
    moveQuestion,
    addOption,
    removeOption,
    addCondition,
    changeConditionQuestion,
    removeCondition,
    save,
  }
}

export type SurveyEditor = ReturnType<typeof useSurveyEditor>

/** 編集画面の子コンポーネントへ編集状態を渡すためのキー */
export const SURVEY_EDITOR_KEY: InjectionKey<SurveyEditor> = Symbol('survey-editor')

/** 編集画面の子コンポーネントから編集状態を取り出す */
export function useInjectedSurveyEditor(): SurveyEditor {
  const editor = inject(SURVEY_EDITOR_KEY)
  if (!editor) throw new Error('SurveyEditor が provide されていません')
  return editor
}
