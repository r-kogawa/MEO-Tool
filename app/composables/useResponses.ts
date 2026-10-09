import type { Question, SurveyResponse } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { getResponsesCsvFunc } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-14 回答一覧・集計・CSV

export const PAGE_SIZE = 25

/** 本物モードの回答一覧に出す注意書き（useFirestoreSync は直近 90 日・最大 2,000 件だけを購読する） */
export const RESPONSE_WINDOW_NOTICE = '直近 90 日・最大 2,000 件を表示しています。それより前は CSV で確認してください'

export interface ResponseFilters {
  /** 直近の日数。null は全期間 */
  days: number | null
  eligibility: 'all' | 'eligible' | 'not-eligible'
  redirect: 'all' | 'redirected' | 'not-redirected'
}

export function useResponses(surveyId: string) {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore } = useCurrentOrg()

  /** 本物モードは購読の範囲（直近 90 日・2,000 件）だけを表示している */
  const isWindowed = computed(() => !isMock.value)

  const filters = reactive<ResponseFilters>({ days: 30, eligibility: 'all', redirect: 'all' })
  const page = ref(1)
  watch(filters, () => { page.value = 1 })

  const allResponses = computed(() =>
    db.value.responses
      .filter(item => item.surveyId === surveyId && item.orgId === orgId.value && canAccessStore(item.storeId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

  const filteredResponses = computed(() => {
    const since = filters.days === null ? 0 : Date.now() - filters.days * 86_400_000
    return allResponses.value.filter((item) => {
      if (Date.parse(item.createdAt) < since) return false
      if (filters.eligibility === 'eligible' && !item.isEligible) return false
      if (filters.eligibility === 'not-eligible' && item.isEligible) return false
      if (filters.redirect === 'redirected' && !item.redirectedAt) return false
      if (filters.redirect === 'not-redirected' && item.redirectedAt) return false
      return true
    })
  })

  const pageCount = computed(() => Math.max(1, Math.ceil(filteredResponses.value.length / PAGE_SIZE)))
  const pagedResponses = computed(() => filteredResponses.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

  /** 全バージョンの設問を ID でまとめる（バージョンをまたいだ集計・表示用） */
  const questions = computed(() => {
    const map = new Map<string, Question>()
    db.value.surveyVersions
      .filter(item => item.surveyId === surveyId)
      .sort((a, b) => a.version - b.version)
      .forEach(version => version.content.questions.forEach(question => map.set(question.id, question)))
    return [...map.values()]
  })

  /** 本物モードはサーバーで検索し直す（期間だけで絞り込む。最大 5,000 件） */
  async function fetchCsv(): Promise<string> {
    if (!isMock.value) {
      const from = filters.days === null ? null : new Date(Date.now() - filters.days * 86_400_000).toISOString()
      const { csv } = await callFunction<object, { csv: string }>($functions, 'getResponsesCsv', { orgId: orgId.value, surveyId, from })
      return csv
    }
    await mockLatency()
    return getResponsesCsvFunc(db.value, user.value!.uid, orgId.value, surveyId, filteredResponses.value)
  }

  async function downloadCsv(): Promise<void> {
    const csv = await fetchCsv()
    // Excel で文字化けしないよう BOM を付ける
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `responses-${surveyId}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return { filters, page, pageCount, allResponses, filteredResponses, pagedResponses, questions, isWindowed, downloadCsv }
}

/** 回答の値を表示用の文字列にする */
export function formatAnswer(question: Question, response: SurveyResponse): string {
  const answer = response.answers[question.id]
  if (answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)) return '—'
  if (question.type === 'single' || question.type === 'multi') {
    const ids = Array.isArray(answer) ? answer : [String(answer)]
    return ids.map(id => question.options.find(option => option.id === id)?.label ?? id).join('、')
  }
  if (question.type === 'rating') return `★${answer}`
  return String(answer)
}
