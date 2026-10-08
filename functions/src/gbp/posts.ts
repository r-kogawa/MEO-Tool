import { FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { withConnectionErrors } from '../google/gbpClientFactory'
import { addAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { commitWrites, type WriteOp } from '../shared/firestoreWrites'
import { GbpApiError, toV4LocationPath, type GbpClient, type GbpLocalPost } from '../shared/gbp'
import { requireMember, requireOrg, requireStoreAccess } from '../shared/members'
import { runBatch, type BatchResult } from '../shared/runBatch'
import { asObject, requireId, requireStringArray } from '../shared/validation'
import { fromLocalPost, readPostInput, toLocalPostInput, type PostInput } from './postMapping'
import { createClientPool, loadGbpStores, type GbpStore } from './storeAccess'

// 投稿の作成（個別と一括は同じ関数）・削除・同期

export const MAX_POST_STORES = 20

const postsPath = (orgId: string) => `organizations/${orgId}/gbpPosts`

/** Google の画面など本ツール以外で作られた投稿のドキュメント ID */
function syncedDocId(storeId: string, postName: string): string {
  return `${storeId}_${postName.split('/').pop()!.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function toPostFields(orgId: string, storeId: string, post: PostInput): Record<string, unknown> {
  const { topicType, summary, mediaUrl, callToAction, event, offer } = post
  return { orgId, storeId, topicType, summary, mediaUrl, callToAction, event, offer }
}

function readStoreIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) fail('invalid-argument', '投稿する店舗を選んでください。')
  if (value.length > MAX_POST_STORES) fail('invalid-argument', `一度に投稿できるのは ${MAX_POST_STORES} 店舗までです。`)
  return requireStringArray(value, '店舗', MAX_POST_STORES)
}

interface CreateContext {
  db: Firestore
  orgId: string
  requestId: string
  post: PostInput
  uid: string
  clientOf: (connectionId: string) => Promise<GbpClient>
}

/** 作成中の印の有効期間。createGbpPosts の timeoutSeconds（300 秒）より長くし、途中で落ちた処理の印は失効させる */
const CLAIM_TTL_MS = 10 * 60 * 1000

/**
 * GBP を呼ぶ前に、トランザクションで「作成中」の印を書く。
 * 作成済みなら 'done'、別の処理が作成中なら 'busy'。同じ requestId の処理が並行しても GBP を 1 回だけ呼ぶため
 */
async function claimStorePost(db: Firestore, ref: DocumentReference, base: Record<string, unknown>): Promise<'claimed' | 'done' | 'busy'> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.get('postName')) return 'done'
    const claimedAt = snapshot.get('claimedAt')
    if (claimedAt instanceof Timestamp && Date.now() - claimedAt.toMillis() < CLAIM_TTL_MS) return 'busy'
    transaction.set(ref, { ...base, postName: null, state: 'PROCESSING', searchUrl: null, errorMessage: null, claimedAt: Timestamp.now() })
    return 'claimed'
  })
}

/** 1 店舗に投稿する。GBP の失敗は FAILED として残してから投げ直す（runBatch が理由を集める） */
async function createStorePost(context: CreateContext, store: GbpStore): Promise<void> {
  const { db, orgId, requestId, post, uid, clientOf } = context
  const ref = db.doc(`${postsPath(orgId)}/${requestId}_${store.id}`)
  const base = { ...toPostFields(orgId, store.id, post), requestId, createdBy: uid, createdAt: FieldValue.serverTimestamp() }
  // 同じ requestId で作成済み・作成中なら作り直さない（再送・Functions の再実行・画面の待ち切れでの二重投稿を防ぐ）
  const claim = await claimStorePost(db, ref, base)
  if (claim === 'done') return
  if (claim === 'busy') fail('aborted', '同じ投稿を別の処理で作成中です。少し待ってから投稿一覧を確認してください。')

  let created: GbpLocalPost
  try {
    created = await withConnectionErrors(db, orgId, store.connectionId, async () => {
      const client = await clientOf(store.connectionId)
      return client.createLocalPost(toV4LocationPath(store.gbpAccountName, store.gbpLocationName), toLocalPostInput(post))
    })
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await ref.set({ ...base, postName: null, state: 'FAILED', searchUrl: null, errorMessage, claimedAt: null })
    throw error
  }
  await ref.set({ ...base, postName: created.name, state: fromLocalPost(created)?.state ?? 'PROCESSING', searchUrl: created.searchUrl ?? null, errorMessage: null, claimedAt: null })
}

export async function createGbpPostsFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<BatchResult<string>> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const requestId = requireId(input.requestId, 'リクエスト ID')
  const storeIds = readStoreIds(input.storeIds)
  const post = readPostInput(input.post)
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  // 担当外・未連携の店舗が 1 つでもあれば、GBP を呼ぶ前に全体をエラーにする
  const stores = await loadGbpStores(db, orgId, member, storeIds)

  const context: CreateContext = { db, orgId, requestId, post, uid: caller.uid, clientOf: createClientPool(db, orgId, deps) }
  const result = await runBatch(stores, store => store.id, store => createStorePost(context, store))
  await addAuditLog(db, orgId, 'gbpPost.create', caller.uid, {
    requestId, topicType: post.topicType, requested: stores.length, succeeded: result.succeeded.length,
  })
  return result
}

/** Google 側で既に消えている投稿（404）は削除済みとみなす */
async function deleteRemotePost(client: GbpClient, postName: string): Promise<void> {
  try {
    await client.deleteLocalPost(postName)
  }
  catch (error) {
    if (!(error instanceof GbpApiError && error.status === 404)) throw error
  }
}

export async function deleteGbpPostFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const postId = requireId(input.postId, '投稿 ID')
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  const post = await db.doc(`${postsPath(orgId)}/${postId}`).get()
  if (!post.exists) fail('not-found', '投稿が見つかりません。')
  requireStoreAccess(member, post.get('storeId'))

  // 作成に失敗した投稿（postName なし）は GBP に存在しないので、キャッシュだけ消す
  const postName = post.get('postName') as string | null
  if (postName) {
    const [store] = await loadGbpStores(db, orgId, member, [post.get('storeId')])
    await withConnectionErrors(db, orgId, store!.connectionId, async () => {
      await deleteRemotePost(await createClientPool(db, orgId, deps)(store!.connectionId), postName)
    })
  }
  await post.ref.delete()
  await addAuditLog(db, orgId, 'gbpPost.delete', caller.uid, { postId })
}

/**
 * 店舗の投稿を GBP と揃える。本ツールで作った投稿は作成者・requestId を残したまま状態などを更新し、
 * Google 側で消えた投稿は削除する。作成に失敗した投稿（postName なし）は残す。
 */
async function syncStorePosts(db: Firestore, orgId: string, store: GbpStore, client: GbpClient): Promise<void> {
  const posts = await client.listLocalPosts(toV4LocationPath(store.gbpAccountName, store.gbpLocationName))
  const collection = db.collection(postsPath(orgId))
  const existing = (await collection.where('storeId', '==', store.id).get()).docs.filter(doc => doc.get('postName'))
  const byName = new Map<string, DocumentReference>(existing.map(doc => [doc.get('postName') as string, doc.ref]))

  const writes: WriteOp[] = []
  const seen = new Set<string>()
  for (const post of posts) {
    const fields = fromLocalPost(post)
    if (!fields) continue
    seen.add(post.name)
    const doc = { ...toPostFields(orgId, store.id, fields), postName: post.name, state: fields.state, searchUrl: fields.searchUrl, errorMessage: null }
    const current = byName.get(post.name)
    if (current) {
      writes.push(batch => batch.update(current, doc))
      continue
    }
    const createdAt = post.createTime ? Timestamp.fromDate(new Date(post.createTime)) : FieldValue.serverTimestamp()
    writes.push(batch => batch.set(collection.doc(syncedDocId(store.id, post.name)), { ...doc, requestId: null, createdBy: null, createdAt }))
  }
  for (const [name, ref] of byName) {
    if (!seen.has(name)) writes.push(batch => batch.delete(ref))
  }
  await commitWrites(db, writes)
}

export async function updateGbpPostsSyncFunc(
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
  const stores = await loadGbpStores(db, orgId, member, storeIds)
  const clientOf = createClientPool(db, orgId, deps)
  return runBatch(stores, store => store.id, store => withConnectionErrors(db, orgId, store.connectionId, async () => {
    await syncStorePosts(db, orgId, store, await clientOf(store.connectionId))
  }))
}
