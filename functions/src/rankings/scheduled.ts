import { logger } from 'firebase-functions'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { orgRef } from '../shared/members'
import { defaultRankDeps, type RankDeps } from './rankDeps'
import { releaseRankChecks, reserveRankChecks } from './usage'
import { toJstDayKey } from './validation'

// scheduledRankCheck の本体。有効なキーワードを組織ごとに予約してから投入する。
// 投入の間隔は rankCheckWorker の rateLimits（maxDispatchesPerSecond）で空ける

/**
 * 組織の今日の予約件数を 1 回だけ決める（Cloud Scheduler の再実行で二重に数えない）。
 * 利用停止中・削除済みの組織は null。
 * 投入に失敗して戻した分（granted < wanted）は、再実行のときにもう一度予約する
 */
async function grantForOrg(db: Firestore, orgId: string, wanted: number, day: string, now: Date): Promise<number | null> {
  return db.runTransaction(async (tx) => {
    const runRef = db.doc(`rankRuns/${day}/orgs/${orgId}`)
    const [run, org] = await Promise.all([tx.get(runRef), tx.get(orgRef(db, orgId))])
    if (!org.exists || org.get('status') !== 'active') return null
    if (run.exists) {
      const previous = run.get('granted') as number
      const missing = (run.get('wanted') as number) - previous
      if (missing <= 0) return previous
      const extra = await reserveRankChecks(tx, db, orgId, org.get('limits.monthlyRankChecks') as number, missing, now)
      if (extra > 0) tx.update(runRef, { granted: FieldValue.increment(extra) })
      return previous + extra
    }
    const granted = await reserveRankChecks(tx, db, orgId, org.get('limits.monthlyRankChecks') as number, wanted, now)
    tx.set(runRef, { orgId, granted, wanted })
    return granted
  })
}

/** 投入に失敗した件数を、使用回数と予約件数の両方から戻す（先に使用回数。途中で落ちても二重に数えない） */
async function releaseFailed(db: Firestore, orgId: string, day: string, now: Date, failed: number): Promise<void> {
  await releaseRankChecks(db, orgId, now, failed)
  await db.doc(`rankRuns/${day}/orgs/${orgId}`).update({ granted: FieldValue.increment(-failed) })
}

/** 1 件の失敗で他の組織が止まらないよう、キーワードごとに投入する。失敗した件数を返す */
async function enqueueKeywords(deps: RankDeps, orgId: string, keywordIds: string[], checkedOn: string): Promise<number> {
  let failed = 0
  for (const keywordId of keywordIds) {
    try {
      await deps.enqueue({ kind: 'keyword', orgId, keywordId, trigger: 'scheduled', checkedOn }, { id: `${orgId}-${keywordId}-${checkedOn}` })
    }
    catch (error) {
      failed++
      logger.error('順位の定期計測の投入に失敗しました', { orgId, keywordId, error: String(error) })
    }
  }
  return failed
}

export async function runScheduledRankCheck(db: Firestore, deps: RankDeps = defaultRankDeps): Promise<{ enqueued: number; skippedOrgs: number; failed: number }> {
  const now = deps.now()
  const checkedOn = toJstDayKey(now)
  const active = await db.collectionGroup('rankKeywords').where('isActive', '==', true).get()
  const keywordIdsByOrg = new Map<string, string[]>()
  for (const keyword of active.docs) {
    const orgId = keyword.get('orgId') as string
    keywordIdsByOrg.set(orgId, [...(keywordIdsByOrg.get(orgId) ?? []), keyword.id])
  }

  let enqueued = 0
  let skippedOrgs = 0
  let failed = 0
  for (const [orgId, keywordIds] of keywordIdsByOrg) {
    const granted = await grantForOrg(db, orgId, keywordIds.length, checkedOn, now)
    if (granted === null) continue
    // 月の上限で一部（または全部）を計測できなかった組織
    if (granted < keywordIds.length) skippedOrgs++
    const targets = keywordIds.slice(0, granted)
    const failedInOrg = await enqueueKeywords(deps, orgId, targets, checkedOn)
    if (failedInOrg > 0) await releaseFailed(db, orgId, checkedOn, now, failedInOrg)
    enqueued += targets.length - failedInOrg
    failed += failedInOrg
  }
  return { enqueued, skippedOrgs, failed }
}
