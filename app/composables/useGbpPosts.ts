import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import type { BatchResult, GbpPost, GbpPostInput } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { createGbpPostsFunc, deleteGbpPostFunc, updateGbpPostsSyncFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// 投稿の一覧・同期・作成（個別と一括は同じ関数）・削除と、投稿画像のアップロード

export function useGbpPosts() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStoreIds } = useCurrentOrg()
  const { $functions, $storage } = useNuxtApp()

  /** 自分が扱える店舗の投稿（新しい順） */
  const posts = computed<GbpPost[]>(() =>
    db.value.gbpPosts
      .filter(post => post.orgId === orgId.value && visibleStoreIds.value.includes(post.storeId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

  async function syncPosts(storeIds?: string[]): Promise<BatchResult> {
    if (!isMock) return callFunction($functions, 'updateGbpPostsSync', { orgId: orgId.value, storeIds })
    await mockLatency(600)
    return updateGbpPostsSyncFunc(db.value, user.value!.uid, orgId.value, storeIds)
  }

  /** requestId は画面ごとに 1 つ発行し、再送でも同じ値を使う（作成済みの店舗に二重投稿しない） */
  async function createPosts(requestId: string, storeIds: string[], post: GbpPostInput): Promise<BatchResult> {
    // サーバーは最大 300 秒動くため、画面が先に待ちを切らないようにする（切れると再送が並行処理になる）
    if (!isMock) return callFunction($functions, 'createGbpPosts', { orgId: orgId.value, requestId, storeIds, post }, { timeoutMs: 310_000 })
    await mockLatency(800)
    return createGbpPostsFunc(db.value, user.value!.uid, orgId.value, requestId, storeIds, post)
  }

  async function deletePost(postId: string): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'deleteGbpPost', { orgId: orgId.value, postId })
      return
    }
    await mockLatency()
    deleteGbpPostFunc(db.value, user.value!.uid, orgId.value, postId)
  }

  /** 画像を Storage に置き、Google が取得できるダウンロード URL を返す（モックはブラウザ内の URL） */
  async function uploadImage(file: File): Promise<string> {
    const error = validatePostImage(file)
    if (error) throw new Error(error)
    if (isMock) {
      await mockLatency()
      return URL.createObjectURL(file)
    }
    const extension = file.type === 'image/png' ? 'png' : 'jpg'
    const fileRef = storageRef($storage, `orgs/${orgId.value}/gbpPosts/${crypto.randomUUID()}.${extension}`)
    await uploadBytes(fileRef, file, { contentType: file.type })
    return getDownloadURL(fileRef)
  }

  return { posts, syncPosts, createPosts, deletePost, uploadImage }
}
