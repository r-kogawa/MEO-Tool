import { logger } from 'firebase-functions'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { fail } from '../shared/errors'
import { asObject, requireId, requireOneOf, requireString } from '../shared/validation'
import { matchStore } from './matchStore'
import { RankProviderError } from './providers/rankProvider'
import type { RankDeps } from './rankDeps'
import type { MatchedBy, RankErrorCode, RankResult, RankTask, SearchLocation } from './types'

// rankCheckWorker の本体（docs/superpowers/specs/2026-10-08-rank-scraping-design.md 3.3〜3.5）

export const RANK_MAX_ATTEMPTS = 3
const PROVIDER_NAME = 'gmaps-scraper'
// ブロックが続く日の打ち切り条件
const CUT_OFF_MIN_BLOCKED = 10
const CUT_OFF_RATIO = 0.3
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type Outcome = { status: 'ok'; results: RankResult[] } | { status: 'error'; errorCode: RankErrorCode }
interface Attempt { isFinalAttempt: boolean }

export function parseRankTask(data: unknown): RankTask {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  if (input.kind === 'search') return { kind: 'search', orgId, searchId: requireId(input.searchId, 'その場計測 ID') }
  if (input.kind !== 'keyword') fail('invalid-argument', 'タスクの種類が正しくありません。')
  const checkedOn = requireString(input.checkedOn, '計測日', 10)
  if (!DAY_PATTERN.test(checkedOn)) fail('invalid-argument', '計測日の形式が正しくありません。')
  return {
    kind: 'keyword',
    orgId,
    keywordId: requireId(input.keywordId, 'キーワード ID'),
    trigger: requireOneOf(input.trigger, ['scheduled', 'manual'] as const, '計測の種類'),
    checkedOn,
  }
}

/** 取得する。最後の試行以外の失敗は例外のまま投げて Cloud Tasks の再試行に回す */
async function fetchOutcome(deps: RankDeps, keyword: string, at: SearchLocation, attempt: Attempt): Promise<Outcome> {
  try {
    return { status: 'ok', results: await deps.provider.search(keyword, { lat: at.lat, lng: at.lng }) }
  }
  catch (error) {
    if (!attempt.isFinalAttempt) throw error
    const errorCode = error instanceof RankProviderError ? error.code : 'parse'
    logger.warn('順位の取得に失敗しました', { keyword, errorCode, error: String(error) })
    return { status: 'error', errorCode }
  }
}

async function loadStoreForMatch(db: Firestore, orgId: string, storeId: string | null) {
  if (!storeId) return null
  const store = await db.doc(`organizations/${orgId}/stores/${storeId}`).get()
  return store.exists ? { placeId: (store.get('placeId') as string | undefined) ?? null, name: (store.get('name') as string | undefined) ?? '' } : null
}

function matchOf(outcome: Outcome, store: Awaited<ReturnType<typeof loadStoreForMatch>>): { rank: number | null; matchedBy: MatchedBy } {
  return outcome.status === 'ok' ? matchStore(outcome.results, store) : { rank: null, matchedBy: null }
}

/** ブロックが続いている日か。初めて打ち切る時に 1 回だけログを出す */
async function isCutOff(db: Firestore, day: string): Promise<boolean> {
  const ref = db.doc(`rankRuns/${day}`)
  const run = await ref.get()
  const blocked = (run.get('blocked') as number | undefined) ?? 0
  const done = (run.get('done') as number | undefined) ?? 0
  if (blocked < CUT_OFF_MIN_BLOCKED || blocked / (blocked + done) <= CUT_OFF_RATIO) return false
  const isFirst = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref)
    if (current.get('cutOffAt')) return false
    tx.update(ref, { cutOffAt: FieldValue.serverTimestamp() })
    return true
  })
  if (isFirst) logger.error('Google マップでのブロックが続いたため、本日の定期計測を打ち切りました', { day, blocked, done })
  return true
}

async function recordRun(db: Firestore, day: string, outcome: Outcome): Promise<void> {
  const field = outcome.status === 'error' && outcome.errorCode === 'blocked' ? 'blocked' : 'done'
  await db.doc(`rankRuns/${day}`).set({ day, [field]: FieldValue.increment(1) }, { merge: true })
}

async function runKeywordTask(db: Firestore, task: Extract<RankTask, { kind: 'keyword' }>, deps: RankDeps, attempt: Attempt): Promise<void> {
  const keywordRef = db.doc(`organizations/${task.orgId}/rankKeywords/${task.keywordId}`)
  const keyword = await keywordRef.get()
  if (!keyword.exists) return
  if (task.trigger === 'scheduled' && keyword.get('isActive') !== true) return

  const storeId = keyword.get('storeId') as string
  const wasCutOff = task.trigger === 'scheduled' && await isCutOff(db, task.checkedOn)
  const outcome: Outcome = wasCutOff
    ? { status: 'error', errorCode: 'blocked' }
    : await fetchOutcome(deps, keyword.get('keyword') as string, keyword.get('searchLocation') as SearchLocation, attempt)
  const match = matchOf(outcome, outcome.status === 'ok' ? await loadStoreForMatch(db, task.orgId, storeId) : null)

  const id = `${task.keywordId}_${task.checkedOn}`
  const snapshotRef = db.doc(`organizations/${task.orgId}/rankSnapshots/${id}`)
  const resultsRef = db.doc(`organizations/${task.orgId}/rankResults/${id}`)
  await db.runTransaction(async (tx) => {
    const [existing, currentKeyword] = await Promise.all([tx.get(snapshotRef), tx.get(keywordRef)])
    // 計測中に削除されたキーワードは作り直さない
    if (!currentKeyword.exists) return
    const keepExisting = outcome.status === 'error' && existing.get('status') === 'ok'
    if (!keepExisting) {
      const base = { orgId: task.orgId, keywordId: task.keywordId, storeId, checkedOn: task.checkedOn }
      tx.set(snapshotRef, {
        ...base,
        checkedAt: deps.now(),
        trigger: task.trigger,
        status: outcome.status,
        errorCode: outcome.status === 'error' ? outcome.errorCode : null,
        rank: match.rank,
        matchedBy: match.matchedBy,
        resultCount: outcome.status === 'ok' ? outcome.results.length : 0,
        provider: PROVIDER_NAME,
      })
      if (outcome.status === 'ok') tx.set(resultsRef, { ...base, results: outcome.results })
    }
    if (task.trigger === 'manual') tx.update(keywordRef, { pendingCheckAt: null })
  })
  if (task.trigger === 'scheduled' && !wasCutOff) await recordRun(db, task.checkedOn, outcome)
}

async function runSearchTask(db: Firestore, task: Extract<RankTask, { kind: 'search' }>, deps: RankDeps, attempt: Attempt): Promise<void> {
  const ref = db.doc(`organizations/${task.orgId}/rankSearches/${task.searchId}`)
  const search = await ref.get()
  if (!search.exists || search.get('status') === 'done' || search.get('status') === 'error') return
  await ref.update({ status: 'running' })

  const outcome = await fetchOutcome(deps, search.get('keyword') as string, search.get('searchLocation') as SearchLocation, attempt)
  const store = outcome.status === 'ok' ? await loadStoreForMatch(db, task.orgId, (search.get('storeId') as string | null) ?? null) : null
  const match = matchOf(outcome, store)
  await ref.update(outcome.status === 'ok'
    ? { status: 'done', results: outcome.results, rank: match.rank, matchedBy: match.matchedBy, errorCode: null, finishedAt: deps.now() }
    : { status: 'error', errorCode: outcome.errorCode, finishedAt: deps.now() })
}

export async function runRankTask(db: Firestore, task: RankTask, deps: RankDeps, attempt: Attempt): Promise<void> {
  if (task.kind === 'search') return runSearchTask(db, task, deps, attempt)
  return runKeywordTask(db, task, deps, attempt)
}
