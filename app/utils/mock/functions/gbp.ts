import type { BatchResult, GbpPostInput, GbpProfilePatch, Store } from '~/types/domain'
import { MAX_POST_STORES, POST_SUMMARY_MAX } from '../../gbpPost'
import { createId } from '../random'
import type { MockDb } from '../seed'
import { MockFunctionsError, requireMember, requireStoreAccess } from './shared'

// gbp/ … プロフィール・口コミ・返信テンプレート（本番は GBP を呼ぶ。モックは仮データを更新する）

const MAX_REPLY_BYTES = 4096

function linkedStores(db: MockDb, orgId: string, uid: string, storeIds?: string[]): Store[] {
  const member = requireMember(db, orgId, uid)
  const candidates = db.stores.filter(store => store.orgId === orgId && store.status === 'active' && store.gbpLocationName)
  if (!storeIds) return candidates.filter(store => member.role !== 'staff' || member.storeIds.includes(store.id))
  storeIds.forEach(id => requireStoreAccess(member, id))
  return storeIds.map((id) => {
    const store = candidates.find(item => item.id === id)
    if (!store) throw new MockFunctionsError('failed-precondition', '店舗が Google ビジネスプロフィールと連携していません。')
    return store
  })
}

export function updateGbpProfilesSyncFunc(db: MockDb, uid: string, orgId: string, storeIds?: string[]): BatchResult {
  const stores = linkedStores(db, orgId, uid, storeIds)
  const now = new Date().toISOString()
  for (const store of stores) {
    const profile = db.gbpProfiles.find(item => item.storeId === store.id)
    if (profile) profile.syncedAt = now
  }
  return { succeeded: stores.map(store => store.id), failed: [] }
}

export function updateGbpProfileFunc(db: MockDb, uid: string, orgId: string, storeId: string, patch: GbpProfilePatch): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  linkedStores(db, orgId, uid, [storeId])
  if (Object.keys(patch).length === 0) throw new MockFunctionsError('invalid-argument', '変更する項目がありません。')
  if ((patch.description ?? '').length > 750) throw new MockFunctionsError('invalid-argument', '説明は 750 文字以内にしてください。')
  if (patch.websiteUri && !/^https?:\/\/\S+$/.test(patch.websiteUri)) {
    throw new MockFunctionsError('invalid-argument', 'ウェブサイトは http:// または https:// で始まる URL を入力してください。')
  }
  const profile = db.gbpProfiles.find(item => item.storeId === storeId)
  if (!profile) throw new MockFunctionsError('not-found', 'プロフィールを同期してからやり直してください。')
  // 画面のフォーム（リアクティブなオブジェクト）を受け取るため、structuredClone ではなく JSON で複製する
  Object.assign(profile, JSON.parse(JSON.stringify(patch)) as GbpProfilePatch, { syncedAt: new Date().toISOString() })
}

export function updateGbpReviewsSyncFunc(db: MockDb, uid: string, orgId: string, storeIds?: string[]): BatchResult {
  const stores = linkedStores(db, orgId, uid, storeIds)
  return { succeeded: stores.map(store => store.id), failed: [] }
}

export function updateGbpReviewReplyFunc(db: MockDb, uid: string, orgId: string, items: { reviewId: string; comment: string }[]): BatchResult {
  const member = requireMember(db, orgId, uid)
  if (items.length === 0) throw new MockFunctionsError('invalid-argument', '返信する口コミを選んでください。')
  if (items.length > 50) throw new MockFunctionsError('invalid-argument', '一度に返信できるのは 50 件までです。')
  const reviews = items.map((item) => {
    if (item.comment.trim() === '') throw new MockFunctionsError('invalid-argument', '返信を入力してください。')
    if (new TextEncoder().encode(item.comment).length > MAX_REPLY_BYTES) {
      throw new MockFunctionsError('invalid-argument', '返信は 4096 バイト以内にしてください（日本語は約 1,300 文字）。')
    }
    const review = db.gbpReviews.find(row => row.id === item.reviewId && row.orgId === orgId)
    if (!review) throw new MockFunctionsError('not-found', '口コミが見つかりません。同期してからやり直してください。')
    requireStoreAccess(member, review.storeId)
    return review
  })
  const now = new Date().toISOString()
  reviews.forEach((review, index) => {
    review.reply = { comment: items[index]!.comment.trim(), updatedAt: now }
    review.hasReply = true
  })
  return { succeeded: items.map(item => item.reviewId), failed: [] }
}

export function deleteGbpReviewReplyFunc(db: MockDb, uid: string, orgId: string, reviewId: string): void {
  const member = requireMember(db, orgId, uid)
  const review = db.gbpReviews.find(row => row.id === reviewId && row.orgId === orgId)
  if (!review) throw new MockFunctionsError('not-found', '口コミが見つかりません。同期してからやり直してください。')
  requireStoreAccess(member, review.storeId)
  review.reply = null
  review.hasReply = false
}

function validateTemplate(input: { name: string; body: string }): { name: string; body: string } {
  const name = input.name.trim()
  const body = input.body.trim()
  if (name === '') throw new MockFunctionsError('invalid-argument', 'テンプレート名を入力してください。')
  if (body === '') throw new MockFunctionsError('invalid-argument', 'テンプレートの本文を入力してください。')
  if (body.length > 2000) throw new MockFunctionsError('invalid-argument', 'テンプレートの本文は 2000 文字以内にしてください。')
  return { name, body }
}

export function createReplyTemplateFunc(db: MockDb, uid: string, orgId: string, input: { name: string; body: string }): string {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const id = createId('tpl')
  db.replyTemplates.push({ id, orgId, ...validateTemplate(input), createdAt: new Date().toISOString() })
  return id
}

export function updateReplyTemplateFunc(db: MockDb, uid: string, orgId: string, templateId: string, input: { name: string; body: string }): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const template = db.replyTemplates.find(item => item.id === templateId && item.orgId === orgId)
  if (!template) throw new MockFunctionsError('not-found', 'テンプレートが見つかりません。')
  Object.assign(template, validateTemplate(input))
}

export function deleteReplyTemplateFunc(db: MockDb, uid: string, orgId: string, templateId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  db.replyTemplates = db.replyTemplates.filter(item => !(item.id === templateId && item.orgId === orgId))
}

function validatePost(post: GbpPostInput): void {
  if (post.topicType === 'STANDARD' && post.summary.trim() === '') throw new MockFunctionsError('invalid-argument', '本文を入力してください。')
  if (post.summary.length > POST_SUMMARY_MAX) throw new MockFunctionsError('invalid-argument', `本文は ${POST_SUMMARY_MAX} 文字以内にしてください。`)
  if (post.topicType === 'OFFER' && post.callToAction) throw new MockFunctionsError('invalid-argument', '特典の投稿にはボタンを付けられません。')
  if (post.topicType === 'STANDARD') return
  if (!post.event || post.event.title.trim() === '' || !post.event.startAt || !post.event.endAt) {
    throw new MockFunctionsError('invalid-argument', 'タイトルと期間を入力してください。')
  }
  if (post.event.endAt <= post.event.startAt) throw new MockFunctionsError('invalid-argument', '終了日時は開始日時より後にしてください。')
}

export function createGbpPostsFunc(db: MockDb, uid: string, orgId: string, requestId: string, storeIds: string[], post: GbpPostInput): BatchResult {
  if (storeIds.length === 0) throw new MockFunctionsError('invalid-argument', '投稿する店舗を選んでください。')
  if (storeIds.length > MAX_POST_STORES) throw new MockFunctionsError('invalid-argument', `一度に投稿できるのは ${MAX_POST_STORES} 店舗までです。`)
  validatePost(post)
  const stores = linkedStores(db, orgId, uid, storeIds)
  const now = new Date().toISOString()
  for (const store of stores) {
    const id = `${requestId}_${store.id}`
    if (db.gbpPosts.some(item => item.id === id && item.postName)) continue
    // 画面のフォーム（リアクティブなオブジェクト）を受け取るため、JSON で複製する
    const content = JSON.parse(JSON.stringify(post)) as GbpPostInput
    db.gbpPosts = [
      ...db.gbpPosts.filter(item => item.id !== id),
      { ...content, id, orgId, storeId: store.id, postName: `${store.gbpLocationName}/localPosts/${createId('p')}`, state: 'LIVE', searchUrl: null, errorMessage: null, createdAt: now },
    ]
  }
  return { succeeded: stores.map(store => store.id), failed: [] }
}

export function deleteGbpPostFunc(db: MockDb, uid: string, orgId: string, postId: string): void {
  const member = requireMember(db, orgId, uid)
  const post = db.gbpPosts.find(item => item.id === postId && item.orgId === orgId)
  if (!post) throw new MockFunctionsError('not-found', '投稿が見つかりません。')
  requireStoreAccess(member, post.storeId)
  db.gbpPosts = db.gbpPosts.filter(item => item.id !== postId)
}

export function updateGbpPostsSyncFunc(db: MockDb, uid: string, orgId: string, storeIds?: string[]): BatchResult {
  const stores = linkedStores(db, orgId, uid, storeIds)
  return { succeeded: stores.map(store => store.id), failed: [] }
}
