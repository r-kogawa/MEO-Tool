import { doc, getDoc } from 'firebase/firestore'
import type { Answers, PublicSurvey } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { toPublicSurvey } from '~/utils/firebase/converters'
import { postSurveyResponseFunc, isWithinPeriod } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-10 回答画面。公開スナップショット（publicSurveys）だけを読み、遷移条件は受け取らない。
// 本物モードは publicSurveys/{slug} を 1 回だけ読み（購読しない）、送信は postSurveyResponse（Functions）で行う。

export type PublicSurveyAvailability = 'loading' | 'available' | 'not-found' | 'paused' | 'out-of-period'

export interface SubmissionResult {
  responseId: string
  isEligible: boolean
  /** 条件を満たしたときだけ店舗の口コミ URL（案内画面で使う） */
  reviewUrl: string | null
}

function sessionKey(slug: string): string {
  return `meo-tool:submission:${slug}`
}

function readSession(slug: string): { submissionId: string; result: SubmissionResult | null } | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(slug))
    return raw ? JSON.parse(raw) : null
  }
  catch {
    return null
  }
}

function writeSession(slug: string, value: { submissionId: string; result: SubmissionResult | null }): void {
  try {
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(value))
  }
  catch {
    // 保存できなくても回答自体は送れる（再送時の重複防止だけが効かなくなる）
  }
}

export function usePublicSurvey(slug: string) {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { $db, $functions } = useNuxtApp()

  const loaded = ref<PublicSurvey | null>(null)
  const isLoading = ref(!isMock)

  async function load(): Promise<void> {
    try {
      const found = await getDoc(doc($db, 'publicSurveys', slug))
      loaded.value = found.exists() ? toPublicSurvey(found.data()) : null
    }
    catch {
      // 読めない（不正な slug・通信エラー）ときは「見つかりません」と同じ表示にする
      loaded.value = null
    }
    finally {
      isLoading.value = false
    }
  }
  if (!isMock) void load()

  const snapshot = computed<PublicSurvey | null>(() =>
    isMock ? db.value.publicSurveys.find(item => item.slug === slug) ?? null : loaded.value)
  const availability = computed<PublicSurveyAvailability>(() => {
    if (isLoading.value) return 'loading'
    if (!snapshot.value) return 'not-found'
    // 組織の利用停止中も、回答者には「受付停止中」と同じ表示にする
    if (snapshot.value.status !== 'published') return 'paused'
    if (!isWithinPeriod(snapshot.value.publishPeriod)) return 'out-of-period'
    return 'available'
  })

  /** 直前に送信した結果（口コミ画面・お礼画面の表示判定に使う） */
  const lastResult = ref<SubmissionResult | null>(readSession(slug)?.result ?? null)

  async function post(submissionId: string, answers: Answers): Promise<SubmissionResult> {
    if (!isMock) return callFunction<object, SubmissionResult>($functions, 'postSurveyResponse', { slug, submissionId, answers })
    await mockLatency(500)
    const posted = postSurveyResponseFunc(db.value, { slug, submissionId, answers })
    // モックの Functions は口コミ URL を返さないため、店舗から補う
    const store = db.value.stores.find(item => item.id === snapshot.value?.storeId)
    return { ...posted, reviewUrl: posted.isEligible ? store?.reviewUrl ?? null : null }
  }

  /**
   * 回答を送信する。submissionId をセッションに残し、通信エラーで再送しても 1 件にする。
   */
  async function submit(answers: Answers): Promise<SubmissionResult> {
    const stored = readSession(slug)
    const submissionId = stored && !stored.result ? stored.submissionId : crypto.randomUUID()
    writeSession(slug, { submissionId, result: null })
    const result = await post(submissionId, answers)
    writeSession(slug, { submissionId, result })
    lastResult.value = result
    return result
  }

  return { snapshot, availability, lastResult, submit }
}
