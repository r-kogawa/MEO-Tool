import type { SurveyContent, SurveyStatus } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { mockLatency } from '~/utils/mock/functions/shared'
import { createSurveyCopyFunc, createSurveyFunc } from '~/utils/mock/functions/surveys'

// F-06 アンケート一覧・作成・複製

/** 本物モードで、作ったアンケートが購読に届くまで待つ上限 */
const SYNC_WAIT_MS = 10_000

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: '下書き',
  published: '公開中',
  paused: '一時停止',
  closed: '終了',
}

export function useSurveys() {
  const isMock = useRuntimeConfig().public.useMock
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore } = useCurrentOrg()

  /** 自分が見られるアンケート（staff は担当店舗のみ）。更新日の新しい順 */
  const surveys = computed(() =>
    db.value.surveys
      .filter(survey => survey.orgId === orgId.value && canAccessStore(survey.storeId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))

  function findSurvey(surveyId: string) {
    return computed(() => surveys.value.find(survey => survey.id === surveyId) ?? null)
  }

  function responseCount(surveyId: string): number {
    return db.value.responses.filter(response => response.surveyId === surveyId).length
  }

  /** 本物モードの回答は直近 90 日分だけ購読しているため、件数に添える注記（モックは空） */
  const responseCountNote = isMock ? '' : '直近 90 日'

  /** 作成直後に編集画面へ移ると、購読が届く前で「見つかりません」になるため、届くまで待つ */
  function waitForSurvey(surveyId: string): Promise<void> {
    const isSynced = () => db.value.surveys.some(survey => survey.id === surveyId)
    if (isSynced()) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(isSynced, (value) => { if (value) finish() })
      const timer = setTimeout(finish, SYNC_WAIT_MS)
      function finish(): void {
        clearTimeout(timer)
        stop()
        resolve()
      }
    })
  }

  async function createSurvey(input: { storeId: string; title: string; content: SurveyContent }): Promise<{ id: string }> {
    if (!isMock) {
      const created = await callFunction<object, { id: string }>($functions, 'createSurvey', { orgId: orgId.value, ...input })
      await waitForSurvey(created.id)
      return created
    }
    await mockLatency()
    return createSurveyFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
  }

  async function copySurvey(surveyId: string, storeId: string): Promise<{ id: string }> {
    if (!isMock) {
      const created = await callFunction<object, { id: string }>($functions, 'createSurveyCopy', { orgId: orgId.value, surveyId, storeId })
      await waitForSurvey(created.id)
      return created
    }
    await mockLatency()
    return createSurveyCopyFunc(db.value, user.value!.uid, orgId.value, surveyId, storeId)
  }

  return { surveys, findSurvey, responseCount, responseCountNote, createSurvey, copySurvey }
}
