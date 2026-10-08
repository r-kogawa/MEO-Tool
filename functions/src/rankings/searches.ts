import { logger } from 'firebase-functions'
import type { Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg } from '../shared/members'
import { asObject, requireId } from '../shared/validation'
import { defaultRankDeps, type RankDeps } from './rankDeps'
import { releaseRankChecks, reserveRankChecks } from './usage'
import { requireKeyword, requireSearchLocation } from './validation'

// rankings/ … その場計測（キーワードを登録せずに地域 + キーワードで計測する）

const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function createRankSearchFunc(db: Firestore, caller: Caller, data: unknown, deps: RankDeps = defaultRankDeps): Promise<{ id: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const keyword = requireKeyword(input.keyword)
  const searchLocation = requireSearchLocation(input.searchLocation)
  const storeId = input.storeId == null ? null : requireId(input.storeId, '店舗 ID')
  const now = deps.now()
  const ref = db.collection(`organizations/${orgId}/rankSearches`).doc()

  await db.runTransaction(async (tx) => {
    const org = await requireOrg(db, orgId, tx)
    await requireMember(db, orgId, caller.uid, ['owner', 'admin'], tx)
    if (storeId && !(await tx.get(db.doc(`organizations/${orgId}/stores/${storeId}`))).exists) fail('not-found', '店舗が見つかりません。')
    const granted = await reserveRankChecks(tx, db, orgId, org.limits.monthlyRankChecks, 1, now)
    if (granted === 0) fail('resource-exhausted', '今月の順位計測数の上限に達しています。')
    tx.create(ref, {
      orgId,
      keyword,
      searchLocation,
      storeId,
      status: 'queued',
      errorCode: null,
      rank: null,
      matchedBy: null,
      results: [],
      createdBy: caller.uid,
      createdAt: now,
      finishedAt: null,
      // Firestore の TTL ポリシーで自動削除する（PROJECT.md の設定手順）
      expireAt: new Date(now.getTime() + SEARCH_TTL_MS),
    })
  })

  try {
    await deps.enqueue({ kind: 'search', orgId, searchId: ref.id }, { id: `search-${ref.id}` })
  }
  catch (error) {
    logger.error('その場計測の投入に失敗しました', { orgId, searchId: ref.id, error: String(error) })
    await releaseRankChecks(db, orgId, now, 1)
    await ref.update({ status: 'error', errorCode: 'timeout', finishedAt: now })
    fail('unavailable', '計測を開始できませんでした。時間をおいて再度お試しください。')
  }
  return { id: ref.id }
}
