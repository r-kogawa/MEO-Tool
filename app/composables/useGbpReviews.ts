import type { BatchResult, GbpReview } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { deleteGbpReviewReplyFunc, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// 口コミの一覧・同期・返信（個別と一括は同じ関数）

export function useGbpReviews() {
  const { isMock } = useDemoSession()
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStoreIds } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  /** 自分が扱える店舗の口コミ（新しい順） */
  const reviews = computed<GbpReview[]>(() =>
    db.value.gbpReviews
      .filter(review => review.orgId === orgId.value && visibleStoreIds.value.includes(review.storeId))
      .sort((a, b) => b.reviewCreatedAt.localeCompare(a.reviewCreatedAt)))

  async function syncReviews(storeIds?: string[]): Promise<BatchResult> {
    if (!isMock.value) return callFunction($functions, 'updateGbpReviewsSync', { orgId: orgId.value, storeIds })
    await mockLatency(600)
    return updateGbpReviewsSyncFunc(db.value, user.value!.uid, orgId.value, storeIds)
  }

  async function replyToReviews(items: { reviewId: string; comment: string }[]): Promise<BatchResult> {
    if (!isMock.value) return callFunction($functions, 'updateGbpReviewReply', { orgId: orgId.value, items })
    await mockLatency(600)
    return updateGbpReviewReplyFunc(db.value, user.value!.uid, orgId.value, items)
  }

  async function deleteReply(reviewId: string): Promise<void> {
    if (!isMock.value) {
      await callFunction($functions, 'deleteGbpReviewReply', { orgId: orgId.value, reviewId })
      return
    }
    await mockLatency()
    deleteGbpReviewReplyFunc(db.value, user.value!.uid, orgId.value, reviewId)
  }

  return { reviews, syncReviews, replyToReviews, deleteReply }
}
