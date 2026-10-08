import { logger } from 'firebase-functions'
import { type Firestore, type Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { commitWrites } from '../shared/firestoreWrites'
import { requireMember, requireOrg, type MemberRole } from '../shared/members'
import { asObject, requireId } from '../shared/validation'
import { defaultRankDeps, type RankDeps } from './rankDeps'
import { releaseRankChecks, reserveRankChecks } from './usage'
import { requireKeyword, requireSearchLocation, toJstDayKey } from './validation'

// rankings/ … 順位キーワードの管理と手動計測（docs/04-features.md F-15 / F-16）

const MANAGERS: MemberRole[] = ['owner', 'admin']
const MANUAL_CHECK_INTERVAL_MS = 60 * 60 * 1000

function keywordsOf(db: Firestore, orgId: string) {
  return db.collection(`organizations/${orgId}/rankKeywords`)
}

/** 手動計測を投入する。失敗したら予約と計測中を戻し、false を返す */
async function enqueueManualCheck(db: Firestore, deps: RankDeps, orgId: string, keywordId: string, now: Date): Promise<boolean> {
  try {
    await deps.enqueue({ kind: 'keyword', orgId, keywordId, trigger: 'manual', checkedOn: toJstDayKey(now) }, { id: `${keywordId}-manual-${now.getTime()}` })
    return true
  }
  catch (error) {
    logger.error('順位計測の投入に失敗しました', { orgId, keywordId, error: String(error) })
    await releaseRankChecks(db, orgId, now, 1)
    await keywordsOf(db, orgId).doc(keywordId).update({ pendingCheckAt: null, lastManualCheckAt: null })
    return false
  }
}

const UNAVAILABLE_MESSAGE = '計測を開始できませんでした。時間をおいて再度お試しください。'

export async function createRankKeywordFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: RankDeps = defaultRankDeps,
): Promise<{ id: string; keyword: string; isChecking: boolean; checkError?: 'limit' | 'unavailable' }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  const keyword = requireKeyword(input.keyword)
  const searchLocation = requireSearchLocation(input.searchLocation)
  const now = deps.now()
  const ref = keywordsOf(db, orgId).doc()

  const isChecking = await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, MANAGERS, tx)
    const store = await tx.get(db.doc(`organizations/${orgId}/stores/${storeId}`))
    if (!store.exists || store.get('status') !== 'active') fail('not-found', '店舗が見つかりません。')
    const count = (await tx.get(keywordsOf(db, orgId).count())).data().count
    if (count >= org.limits.maxKeywords) fail('resource-exhausted', `キーワード数の上限（${org.limits.maxKeywords} 件）に達しています。`)
    const sameKeyword = await tx.get(keywordsOf(db, orgId).where('storeId', '==', storeId).where('keyword', '==', keyword))
    const isDuplicate = sameKeyword.docs.some(doc =>
      doc.get('searchLocation.lat') === searchLocation.lat && doc.get('searchLocation.lng') === searchLocation.lng)
    if (isDuplicate) fail('already-exists', '同じ店舗・キーワード・地点の組み合わせが登録済みです。')
    const granted = await reserveRankChecks(tx, db, orgId, org.limits.monthlyRankChecks, 1, now)
    tx.create(ref, {
      orgId,
      storeId,
      keyword,
      searchLocation,
      isActive: true,
      createdBy: caller.uid,
      createdAt: now,
      pendingCheckAt: granted > 0 ? now : null,
      lastManualCheckAt: granted > 0 ? now : null,
    })
    return granted > 0
  })
  if (!isChecking) return { id: ref.id, keyword, isChecking: false, checkError: 'limit' }
  // 投入に失敗してもキーワードは作成済み。エラーにすると再送が already-exists になるので、結果で知らせる
  if (!(await enqueueManualCheck(db, deps, orgId, ref.id, now))) return { id: ref.id, keyword, isChecking: false, checkError: 'unavailable' }
  return { id: ref.id, keyword, isChecking: true }
}

async function requireKeywordRef(db: Firestore, caller: Caller, data: unknown) {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const keywordId = requireId(input.keywordId, 'キーワード ID')
  await requireOrg(db, orgId)
  await requireMember(db, orgId, caller.uid, MANAGERS)
  const ref = keywordsOf(db, orgId).doc(keywordId)
  if (!(await ref.get()).exists) fail('not-found', 'キーワードが見つかりません。')
  return { input, orgId, keywordId, ref }
}

export async function updateRankKeywordActiveFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  if (typeof asObject(data).isActive !== 'boolean') fail('invalid-argument', '計測の有効・停止の値が正しくありません。')
  const { input, ref } = await requireKeywordRef(db, caller, data)
  await ref.update({ isActive: input.isActive })
}

/** キーワードと、その順位の履歴（スナップショット・結果）を削除する */
export async function deleteRankKeywordFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const { orgId, keywordId, ref } = await requireKeywordRef(db, caller, data)
  const histories = await Promise.all(['rankSnapshots', 'rankResults'].map(name =>
    db.collection(`organizations/${orgId}/${name}`).where('keywordId', '==', keywordId).get()))
  const refs = [...histories.flatMap(history => history.docs.map(doc => doc.ref)), ref]
  await commitWrites(db, refs.map(target => batch => batch.delete(target)))
}

/** 手動計測。同じキーワードは 1 時間に 1 回まで */
export async function postRankCheckFunc(db: Firestore, caller: Caller, data: unknown, deps: RankDeps = defaultRankDeps): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const keywordId = requireId(input.keywordId, 'キーワード ID')
  const now = deps.now()
  const ref = keywordsOf(db, orgId).doc(keywordId)

  await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, MANAGERS, tx)
    const keyword = await tx.get(ref)
    if (!keyword.exists) fail('not-found', 'キーワードが見つかりません。')
    if (keyword.get('isActive') !== true) fail('failed-precondition', '停止中のキーワードは計測できません。')
    const last = keyword.get('lastManualCheckAt') as Timestamp | null | undefined
    if (last && now.getTime() - last.toMillis() < MANUAL_CHECK_INTERVAL_MS) {
      fail('resource-exhausted', '手動計測は同じキーワードにつき 1 時間に 1 回までです。')
    }
    const granted = await reserveRankChecks(tx, db, orgId, org.limits.monthlyRankChecks, 1, now)
    if (granted === 0) fail('resource-exhausted', '今月の順位計測数の上限に達しています。')
    tx.update(ref, { pendingCheckAt: now, lastManualCheckAt: now })
  })
  if (!(await enqueueManualCheck(db, deps, orgId, keywordId, now))) fail('unavailable', UNAVAILABLE_MESSAGE)
}
