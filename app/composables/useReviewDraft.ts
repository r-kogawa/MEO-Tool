import { callFunction } from '~/utils/firebase/callFunction'
import { postReviewRedirectFunc } from '~/utils/mock/functions/responses'
import { mockLatency } from '~/utils/mock/functions/shared'

// F-13 Google 口コミへの遷移。
// 口コミ文面の生成（F-12）は今回は作らない（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 0 章）。
// 案内画面には「Google に口コミを書く」ボタンだけを置く

export function useReviewDraft(slug: string) {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { $functions } = useNuxtApp()

  /** 遷移を記録してから Google の口コミ画面を開く。記録は遷移を妨げないよう待たない（失敗しても回答者には見せない） */
  function openGoogle(responseId: string, reviewUrl: string): void {
    // 仮データの回答（デモ中で、かつ仮データにその slug がある）だけ仮の処理にする
    const isMockSurvey = isMock.value && db.value.publicSurveys.some(item => item.slug === slug)
    const record: Promise<unknown> = isMockSurvey
      ? mockLatency(100).then(() => postReviewRedirectFunc(db.value, responseId))
      : callFunction($functions, 'postReviewRedirect', { slug, submissionId: responseId })
    void record.catch(() => {})
    window.open(reviewUrl, '_blank', 'noopener')
  }

  return { openGoogle }
}
