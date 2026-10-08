import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { withConnectionErrors } from '../google/gbpClientFactory'
import { addAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { commitWrites, type WriteOp } from '../shared/firestoreWrites'
import { starRatingToNumber, toV4LocationPath, type GbpClient, type GbpReview } from '../shared/gbp'
import { requireMember, requireOrg, requireStoreAccess } from '../shared/members'
import { runBatch, type BatchResult } from '../shared/runBatch'
import { asObject, requireId, requireString, requireStringArray } from '../shared/validation'
import { createClientPool, loadGbpStores, type GbpStore } from './storeAccess'

// 口コミの同期・返信（個別と一括は同じ関数）

export const MAX_REPLY_BYTES = 4096
export const MAX_BULK_REPLIES = 50

/** GBP の reviewId を Firestore のドキュメント ID にする（英数字・-・_ 以外は _ に置換） */
export function reviewDocId(reviewId: string): string {
  return reviewId.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** 口コミ ID は長いことがあるため、Firestore のドキュメント ID の上限内で受け付ける */
function requireReviewId(value: unknown): string {
  const id = requireString(value, '口コミ ID', 1500)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail('invalid-argument', '口コミ ID の形式が正しくありません。')
  return id
}

function toTimestamp(iso: string | undefined): Timestamp | null {
  return iso ? Timestamp.fromDate(new Date(iso)) : null
}

export function toReviewDoc(orgId: string, storeId: string, review: GbpReview): Record<string, unknown> {
  const isAnonymous = review.reviewer.isAnonymous === true
  return {
    orgId,
    storeId,
    reviewName: review.name,
    reviewerName: isAnonymous ? '匿名' : review.reviewer.displayName ?? '匿名',
    reviewerPhotoUrl: isAnonymous ? null : review.reviewer.profilePhotoUrl ?? null,
    isAnonymous,
    starRating: starRatingToNumber(review.starRating),
    comment: review.comment ?? null,
    reviewCreatedAt: toTimestamp(review.createTime),
    reviewUpdatedAt: toTimestamp(review.updateTime),
    reply: review.reviewReply ? { comment: review.reviewReply.comment, updatedAt: toTimestamp(review.reviewReply.updateTime) } : null,
    hasReply: review.reviewReply !== undefined,
  }
}

type CachedReply = { comment: string; updatedAt: Timestamp | null } | null

function millisOf(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null
}

/** 同期の値と比べて、キャッシュの返信の方が新しければそれを残す（同期中に画面から返信した場合） */
function mergeReply(doc: Record<string, unknown>, cached: CachedReply): void {
  const apiAt = millisOf((doc.reply as CachedReply)?.updatedAt)
  const cachedAt = millisOf(cached?.updatedAt)
  if (cached && cachedAt !== null && (apiAt === null || cachedAt > apiAt)) {
    doc.reply = cached
    doc.hasReply = true
  }
}

function isUnchanged(doc: Record<string, unknown>, current: DocumentData): boolean {
  const pick = (data: Record<string, unknown>) => JSON.stringify([
    data.starRating,
    data.comment,
    millisOf(data.reviewUpdatedAt),
    (data.reply as CachedReply)?.comment ?? null,
    data.hasReply,
  ])
  return pick(doc) === pick(current)
}

/**
 * 店舗の口コミを GBP と揃える。変化のない口コミは書かず（書き込み量を抑える）、GBP から消えた口コミは削除する。
 */
async function syncStoreReviews(db: Firestore, orgId: string, store: GbpStore, client: GbpClient): Promise<void> {
  const reviews = await client.listAllReviews(toV4LocationPath(store.gbpAccountName, store.gbpLocationName))
  const collection = db.collection(`organizations/${orgId}/gbpReviews`)
  const existing = new Map((await collection.where('storeId', '==', store.id).get()).docs.map(doc => [doc.id, doc]))

  const writes: WriteOp[] = []
  const seen = new Set<string>()
  for (const review of reviews) {
    const id = reviewDocId(review.reviewId)
    seen.add(id)
    const doc = toReviewDoc(orgId, store.id, review)
    const current = existing.get(id)
    if (current) {
      mergeReply(doc, current.get('reply') as CachedReply)
      if (isUnchanged(doc, current.data())) continue
    }
    writes.push(batch => batch.set(collection.doc(id), { ...doc, syncedAt: FieldValue.serverTimestamp() }))
  }
  for (const id of existing.keys()) {
    if (!seen.has(id)) writes.push(batch => batch.delete(collection.doc(id)))
  }
  await commitWrites(db, writes)
}

/** callable と自動同期の両方から使う */
export function syncReviewsForStores(db: Firestore, orgId: string, stores: GbpStore[], deps: GoogleDeps): Promise<BatchResult<string>> {
  const clientOf = createClientPool(db, orgId, deps)
  return runBatch(stores, store => store.id, store => withConnectionErrors(db, orgId, store.connectionId, async () => {
    await syncStoreReviews(db, orgId, store, await clientOf(store.connectionId))
  }))
}

export async function updateGbpReviewsSyncFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<BatchResult<string>> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  const storeIds = input.storeIds === undefined ? undefined : requireStringArray(input.storeIds, '店舗', 100)
  return syncReviewsForStores(db, orgId, await loadGbpStores(db, orgId, member, storeIds), deps)
}

interface ReplyItem {
  reviewId: string
  comment: string
}

function readReplyItems(value: unknown): ReplyItem[] {
  if (!Array.isArray(value) || value.length === 0) fail('invalid-argument', '返信する口コミを選んでください。')
  if (value.length > MAX_BULK_REPLIES) fail('invalid-argument', `一度に返信できるのは ${MAX_BULK_REPLIES} 件までです。`)
  return value.map((item) => {
    const input = asObject(item)
    const comment = requireString(input.comment, '返信', MAX_REPLY_BYTES)
    if (Buffer.byteLength(comment, 'utf8') > MAX_REPLY_BYTES) {
      fail('invalid-argument', '返信は 4096 バイト以内にしてください（日本語は約 1,300 文字）。')
    }
    return { reviewId: requireReviewId(input.reviewId), comment }
  })
}

export async function updateGbpReviewReplyFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<BatchResult<string>> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const items = readReplyItems(input.items)
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)

  // 送信前に全件を検証する（存在・担当店舗）。1 件でも不正なら GBP を呼ばない
  const snapshots = await db.getAll(...items.map(item => db.doc(`organizations/${orgId}/gbpReviews/${item.reviewId}`)))
  const reviews = snapshots.map((snapshot) => {
    if (!snapshot.exists) fail('not-found', '口コミが見つかりません。同期してからやり直してください。')
    requireStoreAccess(member, snapshot.get('storeId'))
    return snapshot
  })
  const stores = new Map((await loadGbpStores(db, orgId, member, [...new Set(reviews.map(review => review.get('storeId') as string))]))
    .map(store => [store.id, store]))
  const clientOf = createClientPool(db, orgId, deps)

  const result = await runBatch(items, item => item.reviewId, async (item) => {
    const review = reviews.find(snapshot => snapshot.id === item.reviewId)!
    const store = stores.get(review.get('storeId'))!
    await withConnectionErrors(db, orgId, store.connectionId, async () => {
      const client = await clientOf(store.connectionId)
      const reply = await client.updateReviewReply(review.get('reviewName'), item.comment)
      await review.ref.update({
        reply: { comment: reply.comment, updatedAt: toTimestamp(reply.updateTime) ?? FieldValue.serverTimestamp() },
        hasReply: true,
      })
    })
  })
  await addAuditLog(db, orgId, 'gbpReview.reply', caller.uid, { requested: items.length, succeeded: result.succeeded.length })
  return result
}

export async function deleteGbpReviewReplyFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const reviewId = requireReviewId(input.reviewId)
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  const review = await db.doc(`organizations/${orgId}/gbpReviews/${reviewId}`).get()
  if (!review.exists) fail('not-found', '口コミが見つかりません。同期してからやり直してください。')
  const [store] = await loadGbpStores(db, orgId, member, [review.get('storeId')])

  await withConnectionErrors(db, orgId, store!.connectionId, async () => {
    const client = await createClientPool(db, orgId, deps)(store!.connectionId)
    await client.deleteReviewReply(review.get('reviewName'))
    await review.ref.update({ reply: null, hasReply: false })
  })
  await addAuditLog(db, orgId, 'gbpReview.deleteReply', caller.uid, { reviewId })
}

/** 毎日の自動同期。連携中の組織（利用停止中は除く）の全店舗の口コミを同期する */
export interface ScheduledSyncOptions {
  /** 処理する組織数の上限（テスト用） */
  maxOrgs?: number
  /** この時刻（ms）を過ぎたら新しい組織に着手しない */
  deadlineMs?: number
}

export async function runScheduledReviewsSync(
  db: Firestore,
  deps: GoogleDeps = defaultGoogleDeps,
  options: ScheduledSyncOptions = {},
): Promise<{ orgCount: number; failedStoreCount: number }> {
  const connections = await db.collectionGroup('googleConnections').where('status', '==', 'active').get()
  const orgIds = [...new Set(connections.docs.map(doc => doc.get('orgId') as string).filter(Boolean))]
  const orgs = (await Promise.all(orgIds.map(orgId => db.doc(`organizations/${orgId}`).get())))
    .filter(org => org.get('status') === 'active')
    // 前回の同期が古い組織から処理する（時間切れで毎日同じ組織が取り残されないように）
    .sort((a, b) => (millisOf(a.get('reviewsSyncedAt')) ?? 0) - (millisOf(b.get('reviewsSyncedAt')) ?? 0))

  let orgCount = 0
  let failedStoreCount = 0
  for (const org of orgs) {
    if (options.maxOrgs !== undefined && orgCount >= options.maxOrgs) break
    if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) {
      logger.warn('口コミの自動同期を時間切れで打ち切りました（残りは次回に処理します）', { remaining: orgs.length - orgCount })
      break
    }
    orgCount++
    const result = await syncReviewsForStores(db, org.id, await loadGbpStores(db, org.id, null), deps)
    await org.ref.update({ reviewsSyncedAt: FieldValue.serverTimestamp() })
    failedStoreCount += result.failed.length
    if (result.failed.length > 0) logger.warn('口コミの自動同期で失敗した店舗があります', { orgId: org.id, failed: result.failed })
  }
  return { orgCount, failedStoreCount }
}
