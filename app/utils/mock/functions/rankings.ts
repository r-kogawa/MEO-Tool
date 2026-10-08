import type { RankKeyword, RankSearch, SearchLocation } from '~/types/domain'
import { toDayKey } from '../../format'
import { keywordErrorOf, normalizeKeyword } from '../../rankKeyword'
import { createId } from '../random'
import { createMockCheck, mockRankFor, mockResultsFor } from '../rank'
import type { MockDb } from '../seed'
import { MockFunctionsError, currentUsage, requireMember, requireOrg } from './shared'

// rankings/ … 順位キーワードと計測（functions/src/rankings/ のモック）

const MANUAL_CHECK_INTERVAL_MS = 60 * 60 * 1000

function reserveCheck(db: MockDb, orgId: string): boolean {
  const org = requireOrg(db, orgId)
  const usage = currentUsage(db, orgId)
  if (usage.rankChecks >= org.limits.monthlyRankChecks) return false
  usage.rankChecks++
  return true
}

function requireKeywordText(value: string): string {
  const error = keywordErrorOf(value)
  if (error) throw new MockFunctionsError('invalid-argument', `${error}。`)
  return normalizeKeyword(value)
}

/** モックでは計測をその場で終える（本番はワーカーが非同期に書く） */
function runCheck(db: MockDb, keyword: RankKeyword, trigger: 'manual' | 'scheduled'): void {
  const store = db.stores.find(item => item.id === keyword.storeId)!
  const now = new Date()
  const day = toDayKey(now)
  const { snapshot, results } = createMockCheck(keyword, store, day, now.toISOString(), trigger)
  // 同じ日の計測は上書き（ドキュメント ID = {keywordId}_{日付}）
  const snapshotIndex = db.rankSnapshots.findIndex(item => item.keywordId === keyword.id && item.checkedOn === day)
  if (snapshotIndex >= 0) db.rankSnapshots.splice(snapshotIndex, 1, snapshot)
  else db.rankSnapshots.push(snapshot)
  if (!results) return
  const resultsIndex = db.rankResults.findIndex(item => item.keywordId === keyword.id && item.checkedOn === day)
  if (resultsIndex >= 0) db.rankResults.splice(resultsIndex, 1, results)
  else db.rankResults.push(results)
}

export function createRankKeywordFunc(
  db: MockDb,
  uid: string,
  input: { orgId: string; storeId: string; keyword: string; searchLocation: SearchLocation },
): { id: string; keyword: string; isChecking: boolean; checkError?: 'limit' | 'unavailable' } {
  const org = requireOrg(db, input.orgId)
  requireMember(db, input.orgId, uid, ['owner', 'admin'])
  const keywordText = requireKeywordText(input.keyword)
  const store = db.stores.find(item => item.id === input.storeId && item.orgId === org.id && item.status === 'active')
  if (!store) throw new MockFunctionsError('not-found', '店舗が見つかりません。')
  const count = db.rankKeywords.filter(item => item.orgId === org.id).length
  if (count >= org.limits.maxKeywords) {
    throw new MockFunctionsError('resource-exhausted', `キーワード数の上限（${org.limits.maxKeywords} 件）に達しています。`)
  }
  const isDuplicate = db.rankKeywords.some(item =>
    item.storeId === input.storeId
    && item.keyword === keywordText
    && item.searchLocation.lat === input.searchLocation.lat
    && item.searchLocation.lng === input.searchLocation.lng)
  if (isDuplicate) throw new MockFunctionsError('already-exists', '同じ店舗・キーワード・地点の組み合わせが登録済みです。')

  const keyword: RankKeyword = {
    id: createId('kw'),
    orgId: org.id,
    storeId: input.storeId,
    keyword: keywordText,
    searchLocation: { ...input.searchLocation },
    isActive: true,
    createdAt: new Date().toISOString(),
    pendingCheckAt: null,
  }
  db.rankKeywords.push(keyword)
  // 登録直後に初回計測を行い、一覧が空にならないようにする（上限に達していれば登録だけ）
  const isChecking = reserveCheck(db, org.id)
  if (isChecking) runCheck(db, keyword, 'manual')
  return isChecking
    ? { id: keyword.id, keyword: keyword.keyword, isChecking }
    : { id: keyword.id, keyword: keyword.keyword, isChecking, checkError: 'limit' }
}

export function updateRankKeywordActiveFunc(db: MockDb, uid: string, orgId: string, keywordId: string, isActive: boolean): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const keyword = db.rankKeywords.find(item => item.id === keywordId && item.orgId === orgId)
  if (!keyword) throw new MockFunctionsError('not-found', 'キーワードが見つかりません。')
  keyword.isActive = isActive
}

export function deleteRankKeywordFunc(db: MockDb, uid: string, orgId: string, keywordId: string): void {
  requireMember(db, orgId, uid, ['owner', 'admin'])
  const index = db.rankKeywords.findIndex(item => item.id === keywordId && item.orgId === orgId)
  if (index < 0) throw new MockFunctionsError('not-found', 'キーワードが見つかりません。')
  db.rankKeywords.splice(index, 1)
  // 履歴もあわせて削除する
  db.rankSnapshots = db.rankSnapshots.filter(item => item.keywordId !== keywordId)
  db.rankResults = db.rankResults.filter(item => item.keywordId !== keywordId)
}

/** 手動計測。同じキーワードは 1 時間に 1 回まで */
export function postRankCheckFunc(db: MockDb, uid: string, orgId: string, keywordId: string): void {
  const member = requireMember(db, orgId, uid, ['owner', 'admin'])
  const keyword = db.rankKeywords.find(item => item.id === keywordId && item.orgId === member.orgId)
  if (!keyword) throw new MockFunctionsError('not-found', 'キーワードが見つかりません。')
  if (!keyword.isActive) throw new MockFunctionsError('failed-precondition', '停止中のキーワードは計測できません。')
  const lastManual = db.rankSnapshots
    .filter(item => item.keywordId === keywordId && item.trigger === 'manual')
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0]
  if (lastManual && Date.now() - Date.parse(lastManual.checkedAt) < MANUAL_CHECK_INTERVAL_MS) {
    throw new MockFunctionsError('resource-exhausted', '手動計測は同じキーワードにつき 1 時間に 1 回までです。')
  }
  if (!reserveCheck(db, orgId)) throw new MockFunctionsError('resource-exhausted', '今月の順位計測数の上限に達しています。')
  runCheck(db, keyword, 'manual')
}

/** その場計測の受け付け。結果は completeMockRankSearch で書く（本番はワーカー） */
export function createRankSearchFunc(
  db: MockDb,
  uid: string,
  input: { orgId: string; keyword: string; searchLocation: SearchLocation; storeId: string | null },
): RankSearch {
  requireMember(db, input.orgId, uid, ['owner', 'admin'])
  const keyword = requireKeywordText(input.keyword)
  if (input.storeId && !db.stores.some(store => store.id === input.storeId && store.orgId === input.orgId)) {
    throw new MockFunctionsError('not-found', '店舗が見つかりません。')
  }
  if (!reserveCheck(db, input.orgId)) throw new MockFunctionsError('resource-exhausted', '今月の順位計測数の上限に達しています。')
  const search: RankSearch = {
    id: createId('rs'),
    orgId: input.orgId,
    keyword,
    searchLocation: { ...input.searchLocation },
    storeId: input.storeId,
    status: 'queued',
    errorCode: null,
    rank: null,
    matchedBy: null,
    results: [],
    createdBy: uid,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  }
  db.rankSearches.push(search)
  return search
}

export function completeMockRankSearch(db: MockDb, searchId: string): void {
  const search = db.rankSearches.find(item => item.id === searchId)
  if (!search || search.status === 'done' || search.status === 'error') return
  const seed = `${search.keyword}|${search.searchLocation.label}`
  const store = search.storeId ? db.stores.find(item => item.id === search.storeId) ?? null : null
  const rank = store ? mockRankFor(seed, toDayKey(new Date())) : null
  search.results = mockResultsFor(seed, store, rank)
  search.rank = rank
  search.matchedBy = rank === null ? null : 'placeId'
  search.status = 'done'
  search.finishedAt = new Date().toISOString()
}
