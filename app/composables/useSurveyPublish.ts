import type { PublishPeriod, SurveyStatus, SurveyStatusAction } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { mockLatency } from '~/utils/mock/functions/shared'
import {
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
  validateSurveyForPublish,
} from '~/utils/mock/functions/surveys'

// F-09 公開管理（公開・一時停止・再開・終了・期間・URL 再発行）

export function useSurveyPublish(surveyId: string) {
  const { isMock } = useDemoSession()
  const { $functions } = useNuxtApp()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()

  const survey = computed(() => db.value.surveys.find(item => item.id === surveyId && item.orgId === orgId.value) ?? null)
  const store = computed(() => db.value.stores.find(item => item.id === survey.value?.storeId))
  const versions = computed(() =>
    db.value.surveyVersions
      .filter(item => item.surveyId === surveyId)
      .sort((a, b) => b.version - a.version))

  /** 公開前チェックで見つかった問題（空なら公開できる）。表示用で、最終的な判定は Functions が行う */
  const publishErrors = computed(() => survey.value ? validateSurveyForPublish(survey.value.draft, store.value) : [])

  const publicUrl = computed(() => survey.value ? `${window.location.origin}/s/${survey.value.publicSlug}` : '')

  const target = () => ({ orgId: orgId.value, surveyId })

  async function publish(): Promise<{ version: number }> {
    if (!isMock.value) return callFunction<object, { version: number }>($functions, 'updateSurveyPublish', target())
    await mockLatency()
    const published = updateSurveyPublishFunc(db.value, user.value!.uid, orgId.value, surveyId)
    return { version: published.currentVersion ?? 1 }
  }

  async function changeStatus(action: SurveyStatusAction): Promise<{ status: SurveyStatus }> {
    if (!isMock.value) return callFunction<object, { status: SurveyStatus }>($functions, 'updateSurveyStatus', { ...target(), action })
    await mockLatency()
    return { status: updateSurveyStatusFunc(db.value, user.value!.uid, orgId.value, surveyId, action).status }
  }

  async function regenerateSlug(): Promise<string> {
    if (!isMock.value) return (await callFunction<object, { slug: string }>($functions, 'updateSurveySlug', target())).slug
    await mockLatency()
    return updateSurveySlugFunc(db.value, user.value!.uid, orgId.value, surveyId)
  }

  async function updatePeriod(period: PublishPeriod): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'updateSurveyPeriod', { ...target(), publishPeriod: period })
      return
    }
    await mockLatency()
    updateSurveyPeriodFunc(db.value, user.value!.uid, orgId.value, surveyId, period)
  }

  return { survey, store, versions, publishErrors, publicUrl, publish, changeStatus, regenerateSlug, updatePeriod }
}
