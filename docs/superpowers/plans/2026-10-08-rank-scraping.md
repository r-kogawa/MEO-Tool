# 検索順位計測（Google マップ スクレイピング） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** キーワード検索・検索順位・競合データの取得を参考サイト（meotool.white-link.com）と同等の仕様に変更する。具体的には、市区町村の選択、上位 20 件の競合、その場計測を実装し、Functions 上の Headless Chrome で Google マップから取得して本接続する。

**Architecture:**
- Functions に `rankings/` を新設する。投入側（callable / onSchedule）と実行側（onTaskDispatched の `rankCheckWorker`）を Cloud Tasks で分ける。
- 取得は `RankProvider` インターフェースの背後に置く。
  - 実装 `gmapsScraper` は Puppeteer の操作だけを担当する。
  - 解析（`parseGmapsItems`）と照合（`matchStore`）は純粋関数として単体テストする。
- 外部依存（取得・タスク投入・現在時刻）は `RankDeps` で差し替え可能にし、Emulator の結合テストではフェイクを使う。
- 画面は既存の `useAppDb` と `useFirestoreSync`（`watchStoreScoped`）の方式で `rankKeywords` / `rankSnapshots` / `rankSearches` を購読する。20 件の結果（`rankResults`）は日付を選んだときに 1 件だけ読む。
- モックモードにも同じ機能を用意する。

**Tech Stack:** firebase-functions 7（onCall / onSchedule / onTaskDispatched）/ firebase-admin 13（`getFunctions().taskQueue`）/ puppeteer-core ＋ @sparticuz/chromium / Nuxt 4 / Tailwind v4

**Spec:** `docs/superpowers/specs/2026-10-08-rank-scraping-design.md`

**前提（既存）:**
- Functions 側
  - `callable(handler, options)`（`functions/src/shared/callable.ts`）
  - `fail`
  - `asObject` / `requireString` / `requireId` / `requireOneOf`
  - `requireOrg` / `requireMember`（tx を渡せる）
  - `orgRef`
  - `commitWrites`
- テスト用
  - `getTestDb` / `clearFirestore` / `caller` / `seedOrg` / `seedStore`（`functions/src/__tests__/emulator.ts`）
- 画面側
  - `useAppDb` / `useFirestoreSync`（`watchStoreScoped` / `MirrorCollection`）
  - `callFunction`
  - `useActionState` / `useToast` / `useCurrentOrg` / `useStores`
  - `FIREBASE_READY_PATHS`
  - `toIso`
  - `toDayKey` / `formatDate` / `formatShortDate`（`app/utils/format.ts`）
- 既存の画面
  - `app/pages/admin/[orgId]/rankings/index.vue`
  - `app/pages/admin/[orgId]/rankings/[keywordId].vue`
  - `KeywordFormModal.vue`
  - `RankTrendChart.vue`
  - `RankDiff.vue`

## Global Constraints

**計測の仕様**
- 計測範囲は上位 20 件（`RANK_LIMIT = 20`）。21 位以下と不一致は圏外（`rank: null`）。「スポンサー」付きのカードは順位から除外する。
- キーワードは、全角スペースを含む空白を半角 1 つにまとめ、前後を除いたうえで 2〜100 文字。スペース区切りは AND 検索になる。
- 検索地点は `{ lat, lng, label }`。サーバーは緯度 20〜46、経度 122〜154、`label` 1〜50 文字を検証する。画面は市区町村（`app/utils/geo/municipalities.json`）から選ぶ。
- 計測 URL は `https://www.google.com/maps/search/{encodeURIComponent(keyword)}/@{lat},{lng},14z?hl=ja&gl=jp`。
- 自店との照合は placeId を優先する。結果の placeId が null のものに限り、NFKC 正規化・空白除去・小文字化した店名の完全一致で照合する。
- `status` は `'ok' | 'error'`、`errorCode` は `'blocked' | 'timeout' | 'parse' | null`。同じ日の `ok` を `error` で上書きしない。

**データの配置**（`{id}` は `{keywordId}_{YYYY-MM-DD}`）

| パス | 内容 |
| --- | --- |
| `organizations/{orgId}/rankKeywords/{keywordId}` | `orgId, storeId, keyword, searchLocation, isActive, createdBy, createdAt, pendingCheckAt, lastManualCheckAt` |
| `organizations/{orgId}/rankSnapshots/{id}` | `orgId, keywordId, storeId, checkedOn, checkedAt, trigger, status, errorCode, rank, matchedBy, resultCount, provider` |
| `organizations/{orgId}/rankResults/{id}` | `orgId, keywordId, storeId, checkedOn, results`（ok のときだけ書く） |
| `organizations/{orgId}/rankSearches/{searchId}` | `orgId, keyword, searchLocation, storeId, status('queued'\|'running'\|'done'\|'error'), errorCode, rank, matchedBy, results, createdBy, createdAt, finishedAt, expireAt` |
| `organizations/{orgId}/usageMonthly/{YYYYMM}` | `orgId, month, rankChecks`。受け付け時に `FieldValue.increment` で加算する |
| `rankRuns/{YYYY-MM-DD}` | `day, done, blocked, cutOffAt` |
| `rankRuns/{YYYY-MM-DD}/orgs/{orgId}` | `granted`。日次計測の二重予約を防ぐ |

**日付と制限**
- 日付と月は JST（`toJstDayKey` / `toJstMonthKey`）。
- 手動計測は同じキーワードで 1 時間に 1 回まで（`lastManualCheckAt`）。
- `pendingCheckAt` は、10 分（`RANK_PENDING_TIMEOUT_MS`）より古ければ計測中とみなさない。
- その場計測の `expireAt` は作成から 30 日後。

**ワーカーとタスク**
- `rankCheckWorker` の設定：`memory: '2GiB'`、`timeoutSeconds: 120`、`concurrency: 1`、`retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 }`、`rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 0.2 }`
- 最後の試行は `retryCount >= 2` で判定する。
- タスク ID
  - 日次：`{orgId}-{keywordId}-{YYYY-MM-DD}`
  - 手動：`{keywordId}-manual-{epochMs}`
  - その場計測：`search-{searchId}`
- 重複投入（`functions/task-already-exists`）は成功として扱う。
- ブロックによる打ち切り：`rankRuns/{day}` の `blocked >= 10` かつ `blocked / (blocked + done) > 0.3` なら、日次のタスクだけ取得をせずに `error / blocked` を保存する。打ち切りのログは `cutOffAt` で 1 回だけ出す。
- `scheduledRankCheck` は毎日 04:00 JST（`timeZone: 'Asia/Tokyo'`）、`timeoutSeconds: 540`。

**権限**
- キーワードの登録・停止・削除、今すぐ計測、その場計測は owner / admin。
- 読み取りはメンバー。staff は担当店舗のみ。`rankSearches` は owner / admin のみ。

**その他**
- 画面の注意書き：「検索順位は検索した人の位置や端末によって変わるため、目安としてご覧ください。」
- region は `setGlobalOptions` の `asia-northeast1`。新しい関数に個別の region は付けない。
- モック（`NUXT_PUBLIC_USE_MOCK` 未設定）の既存画面（ダッシュボードの順位カードを含む）を壊さない。
- コミットはユーザーの許可がある場合のみ（現状: その場で実装・コミットなし）。各タスクの最後は確認手順にする。

## Review Focus

| # | 起こりうること | 期待する動き | テストを置くタスク |
| --- | --- | --- | --- |
| 1 | 同じ日次タスクが 2 回実行される（Cloud Tasks の再配信）、または Cloud Scheduler が同じ日に 2 回起動する | スナップショットは 1 件のまま。使用回数も二重に数えない | Task 4、Task 5 |
| 2 | 同じ日にすでに `ok` があるところへ、手動計測が失敗する | 既存の `ok` と結果が残る。`pendingCheckAt` は解除される | Task 4 |
| 3 | 計測中にキーワードが削除される | ワーカーはキーワードのドキュメントを作り直さず、静かに終わる | Task 4 |
| 4 | 店名に全角英数・全角スペースを含み、placeId が取れなかった結果 | 店名の正規化照合で順位が付く。別の店舗（placeId が異なる）とは店名が同じでも一致させない | Task 2 |
| 5 | タスクの投入（Cloud Tasks）が失敗する | 使用回数を戻し、`pendingCheckAt` を解除して `unavailable` を返す。キーワードが「計測中」のまま残らない | Task 6 |

---

## ファイル構成

**Functions**（`functions/src/rankings/`）

| ファイル | 責務 |
| --- | --- |
| `types.ts` | `RankResult` / `RankTask` / `RankErrorCode` / `MatchedBy` / `SearchLocation` |
| `validation.ts` | `normalizeKeyword` / `requireKeyword` / `requireSearchLocation` / `toJstDayKey` / `toJstMonthKey` |
| `providers/rankProvider.ts` | `RankProvider` / `RankProviderError` / `RawGmapsItem` |
| `providers/parseGmapsItems.ts` | 生データ → `RankResult[]`（純粋関数） |
| `providers/gmapsScraper.ts` | Puppeteer の操作（`gmapsProvider` / `buildSearchUrl`） |
| `matchStore.ts` | `normalizeName` / `matchStore`（純粋関数） |
| `rankDeps.ts` | `RankDeps` / `EnqueueOptions` / `defaultRankDeps`（取得を遅延 import、`taskQueue` への投入） |
| `usage.ts` | `reserveRankChecks` / `releaseRankChecks` |
| `keywords.ts` | `createRankKeywordFunc` / `updateRankKeywordActiveFunc` / `deleteRankKeywordFunc` / `postRankCheckFunc` |
| `searches.ts` | `createRankSearchFunc` |
| `worker.ts` | `RANK_MAX_ATTEMPTS` / `parseRankTask` / `runRankTask` |
| `scheduled.ts` | `runScheduledRankCheck` |
| `__tests__/fakeRank.ts` | テスト用のフェイク `RankDeps` と結果の生成 |
| `__tests__/fixtures/gmapsItems.json` | 2026-10-08 の実画面から抜き出した生データ |
| `__tests__/probe.ts` | 手元での実計測スクリプト（デプロイ対象外） |

**画面**

| ファイル | 責務 |
| --- | --- |
| `app/types/domain.ts` | 順位関連の型を差し替え |
| `app/utils/rankKeyword.ts` | キーワードの正規化と検証、注意書き、エラー文言 |
| `app/utils/geo/municipalities.json` ＋ `app/utils/geo/municipality.ts` | 市区町村のデータと検索・最寄りの計算 |
| `scripts/build-municipalities.mjs` | 国土数値情報 P34 の GeoJSON → JSON |
| `app/utils/mock/rank.ts` / `app/utils/mock/functions/rankings.ts` / `app/utils/mock/seed.ts` | モック |
| `app/utils/firebase/converters.ts` / `app/utils/firebase/emptyDb.ts` / `app/composables/useFirestoreSync.ts` | 本物モードの購読 |
| `app/composables/useRankKeywords.ts` / `useRankHistory.ts` / `useRankSearch.ts`（新規） | 画面のロジック |
| `app/components/Ranking/Input/AreaSelect.vue`（新規） | 市区町村の選択欄 |
| `app/components/Ranking/Common/RankResultsTable.vue`（新規） | 1〜20 位の表 |
| `app/components/Ranking/Search/SearchForm.vue`（新規） | その場計測の入力 |
| `app/components/Ranking/Common/RankTrendChart.vue` / `app/components/Ranking/Rankings/KeywordFormModal.vue` | 変更 |
| `app/pages/admin/[orgId]/rankings/index.vue` / `[keywordId].vue` / `search.vue`（新規） | 画面 |

---

### Task 1: キーワードと検索地点の検証（Functions）

**Files:**
- Create: `functions/src/rankings/types.ts`
- Create: `functions/src/rankings/validation.ts`
- Test: `functions/src/rankings/__tests__/validation.test.ts`

**Interfaces:**
- Produces:
  - `type RankErrorCode = 'blocked' | 'timeout' | 'parse'`
  - `type MatchedBy = 'placeId' | 'name' | null`
  - `interface RankResult { rank: number; placeId: string | null; name: string; rating: number | null; reviewCount: number | null; category: string | null }`
  - `interface SearchLocation { lat: number; lng: number; label: string }`
  - `type RankTask = { kind: 'keyword'; orgId: string; keywordId: string; trigger: 'scheduled' | 'manual'; checkedOn: string } | { kind: 'search'; orgId: string; searchId: string }`
  - `normalizeKeyword(value: string): string`
  - `requireKeyword(value: unknown): string`
  - `requireSearchLocation(value: unknown): SearchLocation`
  - `toJstDayKey(date: Date): string`
  - `toJstMonthKey(date: Date): string`

- [ ] **Step 1: 型を作る**

`functions/src/rankings/types.ts`:

```ts
// 順位計測（docs/superpowers/specs/2026-10-08-rank-scraping-design.md 2 章）の型

export type RankErrorCode = 'blocked' | 'timeout' | 'parse'
export type MatchedBy = 'placeId' | 'name' | null

/** 検索結果の 1 件（1〜20 位） */
export interface RankResult {
  rank: number
  placeId: string | null
  name: string
  rating: number | null
  reviewCount: number | null
  category: string | null
}

export interface SearchLocation {
  lat: number
  lng: number
  label: string
}

/** rankCheckWorker に渡すタスク */
export type RankTask =
  | { kind: 'keyword'; orgId: string; keywordId: string; trigger: 'scheduled' | 'manual'; checkedOn: string }
  | { kind: 'search'; orgId: string; searchId: string }
```

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/rankings/__tests__/validation.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKeyword, requireKeyword, requireSearchLocation, toJstDayKey, toJstMonthKey } from '../validation'

const invalid = { code: 'invalid-argument' }

test('normalizeKeyword: 全角スペース・連続スペースを半角 1 つにし、前後を除く', () => {
  assert.equal(normalizeKeyword('　渋谷　 カフェ  '), '渋谷 カフェ')
  assert.equal(normalizeKeyword('渋谷\tランチ'), '渋谷 ランチ')
})

test('requireKeyword: 正規化後 2〜100 文字', () => {
  assert.equal(requireKeyword('渋谷'), '渋谷')
  assert.equal(requireKeyword('a'.repeat(100)), 'a'.repeat(100))
  assert.throws(() => requireKeyword('渋'), { code: 'invalid-argument', message: 'キーワードは 2〜100 文字で入力してください。' })
  assert.throws(() => requireKeyword(' 渋 '), invalid)
  assert.throws(() => requireKeyword('a'.repeat(101)), invalid)
  assert.throws(() => requireKeyword(1), invalid)
})

test('requireSearchLocation: 日本の範囲内の数値と 1〜50 文字の名前', () => {
  assert.deepEqual(requireSearchLocation({ lat: 35.664, lng: 139.698, label: ' 東京都渋谷区 ' }), { lat: 35.664, lng: 139.698, label: '東京都渋谷区' })
  assert.throws(() => requireSearchLocation({ lat: 0, lng: 139.698, label: 'x' }), { message: '検索地点は日本国内の市区町村を選んでください。' })
  assert.throws(() => requireSearchLocation({ lat: 35.6, lng: 200, label: 'x' }), invalid)
  assert.throws(() => requireSearchLocation({ lat: '35.6', lng: 139.6, label: 'x' }), invalid)
  assert.throws(() => requireSearchLocation({ lat: 35.6, lng: 139.6, label: 'a'.repeat(51) }), invalid)
  assert.throws(() => requireSearchLocation(null), invalid)
})

test('toJstDayKey / toJstMonthKey: JST の日付と月', () => {
  // 2026-10-07T15:30Z は JST 2026-10-08 00:30
  assert.equal(toJstDayKey(new Date('2026-10-07T15:30:00Z')), '2026-10-08')
  assert.equal(toJstDayKey(new Date('2026-10-07T14:59:00Z')), '2026-10-07')
  assert.equal(toJstMonthKey(new Date('2026-10-31T15:00:00Z')), '202611')
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL。`validation.test.ts` のコンパイルで `Cannot find module '../validation'` が出る。

- [ ] **Step 4: 実装する**

`functions/src/rankings/validation.ts`:

```ts
import { fail } from '../shared/errors'
import { asObject, requireString } from '../shared/validation'
import type { SearchLocation } from './types'

export const KEYWORD_MIN_LENGTH = 2
export const KEYWORD_MAX_LENGTH = 100
// 日本の範囲（離島を含む概略）
const LAT_RANGE = [20, 46] as const
const LNG_RANGE = [122, 154] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 全角スペースを含む空白を半角 1 つにまとめ、前後を除く（\s は U+3000 を含む） */
export function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function requireKeyword(value: unknown): string {
  const keyword = typeof value === 'string' ? normalizeKeyword(value) : ''
  if (keyword.length < KEYWORD_MIN_LENGTH || keyword.length > KEYWORD_MAX_LENGTH) {
    fail('invalid-argument', `キーワードは ${KEYWORD_MIN_LENGTH}〜${KEYWORD_MAX_LENGTH} 文字で入力してください。`)
  }
  return keyword
}

function isInRange(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function requireSearchLocation(value: unknown): SearchLocation {
  const input = asObject(value)
  if (!isInRange(input.lat, LAT_RANGE) || !isInRange(input.lng, LNG_RANGE)) {
    fail('invalid-argument', '検索地点は日本国内の市区町村を選んでください。')
  }
  return { lat: input.lat, lng: input.lng, label: requireString(input.label, '検索地点の名前', 50) }
}

/** JST の YYYY-MM-DD */
export function toJstDayKey(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** JST の YYYYMM */
export function toJstMonthKey(date: Date): string {
  return toJstDayKey(date).slice(0, 7).replace('-', '')
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS（既存の単体テストもすべて PASS）

- [ ] **Step 6: 確認**

Run: `git status --short functions/src/rankings`
Expected: `types.ts`、`validation.ts`、`__tests__/validation.test.ts` が未追跡として表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 2: 検索結果の解析と自店の照合（純粋関数）

**Files:**
- Create: `functions/src/rankings/providers/rankProvider.ts`
- Create: `functions/src/rankings/providers/parseGmapsItems.ts`
- Create: `functions/src/rankings/matchStore.ts`
- Create: `functions/src/rankings/__tests__/fixtures/gmapsItems.json`
- Test: `functions/src/rankings/__tests__/parseGmapsItems.test.ts`、`functions/src/rankings/__tests__/matchStore.test.ts`

**Interfaces:**
- Consumes: `RankResult` / `RankErrorCode` / `MatchedBy`（Task 1）
- Produces:
  - `interface RawGmapsItem { name: string; href: string; starLabel: string | null; text: string; isSponsored: boolean }`
  - `interface RankProvider { search(keyword: string, at: { lat: number; lng: number }): Promise<RankResult[]> }`
  - `class RankProviderError extends Error { code: RankErrorCode }`
  - `RANK_LIMIT = 20`
  - `parseGmapsItems(items: RawGmapsItem[]): RankResult[]`
  - `normalizeName(name: string): string`
  - `matchStore(results: RankResult[], store: { placeId: string | null; name: string } | null): { rank: number | null; matchedBy: MatchedBy }`

- [ ] **Step 1: 取得部の型を作る**

`functions/src/rankings/providers/rankProvider.ts`:

```ts
import type { RankErrorCode, RankResult } from '../types'

// 順位の取得元。Google マップのスクレイピング（gmapsScraper）を、後で SERP API などに差し替えられるようにする

/** 画面から抜き出した 1 件分の生データ。解析は parseGmapsItems が行う */
export interface RawGmapsItem {
  /** a[href*="/maps/place/"] の aria-label */
  name: string
  href: string
  /** span[role="img"] の aria-label（例: 「4.1 つ星 クチコミ 195 件」）。評価がない店舗は null */
  starLabel: string | null
  /** 店舗カードの innerText（改行区切り） */
  text: string
  isSponsored: boolean
}

export interface RankProvider {
  /** 上位 20 件を順位順に返す。結果が 0 件なら空配列 */
  search(keyword: string, at: { lat: number; lng: number }): Promise<RankResult[]>
}

export class RankProviderError extends Error {
  constructor(public readonly code: RankErrorCode, message: string) {
    super(message)
    this.name = 'RankProviderError'
  }
}
```

- [ ] **Step 2: fixture を作る**

`functions/src/rankings/__tests__/fixtures/gmapsItems.json`。先頭の 3 件は、2026-10-08 に「渋谷 カフェ」（渋谷区役所付近、ズーム 14）を実際に検索した結果です。残りは境界条件を確かめるための作り物です。

```json
[
  {
    "name": "DUKE Cafe 渋谷神南店",
    "href": "https://www.google.com/maps/place/DUKE+Cafe/data=!4m7!3m6!1s0x60188d0002dd2525:0x232cbec6b4907381!8m2!3d35.66!4d139.70!16s%2Fg%2F11!19sChIJJSXdAgCNGGARgXOQtMa-LCM?authuser=0&hl=ja",
    "starLabel": "4.1 つ星 クチコミ 195 件",
    "text": "DUKE Cafe 渋谷神南店\nDUKE Cafe 渋谷神南店\n4.1(195) · ￥1,000～2,000\nカフェ・喫茶 ·  · 神南１丁目２０−５ Vort渋谷 Briller 6F\n営業中 · 営業終了: 23:00",
    "isSponsored": false
  },
  {
    "name": "Nakaniwa URBAN COFFEE COURTYARD",
    "href": "https://www.google.com/maps/place/Nakaniwa/data=!4m7!3m6!1s0x0:0x0!8m2!3d35.66!4d139.70!16s%2Fg%2F11!19sChIJRwSp3HiNGGARfZL0ETA7Eo4?authuser=0&hl=ja",
    "starLabel": "4.8 つ星 クチコミ 51 件",
    "text": "Nakaniwa URBAN COFFEE COURTYARD\nNakaniwa URBAN COFFEE COURTYARD\n4.8(51) · ￥1,000～2,000\nカフェ・喫茶 · 渋谷１丁目１５−２２ 渋谷セルモビル 2階, 3階\n営業中 · 営業終了: 23:00",
    "isSponsored": false
  },
  {
    "name": "広告のカフェ",
    "href": "https://www.google.com/maps/place/AD/data=!19sChIJ_ad_place_id_00001",
    "starLabel": "4.0 つ星 クチコミ 10 件",
    "text": "広告のカフェ\nスポンサー\n4.0(10)\nカフェ・喫茶 · 渋谷",
    "isSponsored": true
  },
  {
    "name": "yellow 渋谷",
    "href": "https://www.google.com/maps/place/yellow/data=!4m7!3m6!1s0x0:0x0!8m2!3d35.66!4d139.70!16s%2Fg%2F11!19sChIJS1PONKiMGGARRwXhTSebwzM?authuser=0&hl=ja",
    "starLabel": "4.4 つ星 クチコミ 2,123 件",
    "text": "yellow 渋谷\nyellow 渋谷\n4.4(2,123) · ￥2,000～3,000\nカフェ・喫茶 ·  · 宇田川町２６−５ ビル 育真 B1階\n営業中 · 営業終了: 21:00",
    "isSponsored": false
  },
  {
    "name": "新しいカフェ",
    "href": "https://www.google.com/maps/place/new/data=!4m2!3m1!1s0x0:0x1",
    "starLabel": null,
    "text": "新しいカフェ\n新しいカフェ\nコーヒーショップ・喫茶店 · 神南１丁目\n営業中",
    "isSponsored": false
  },
  {
    "name": "DUKE Cafe 渋谷神南店",
    "href": "https://www.google.com/maps/place/DUKE+Cafe/data=!19sChIJJSXdAgCNGGARgXOQtMa-LCM",
    "starLabel": "4.1 つ星 クチコミ 195 件",
    "text": "DUKE Cafe 渋谷神南店",
    "isSponsored": false
  }
]
```

- [ ] **Step 3: 失敗するテストを書く**

`functions/src/rankings/__tests__/parseGmapsItems.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseGmapsItems, RANK_LIMIT } from '../providers/parseGmapsItems'
import type { RawGmapsItem } from '../providers/rankProvider'

// lib-test/rankings/__tests__ から src の fixture を読む
const fixture: RawGmapsItem[] = JSON.parse(readFileSync(resolve(__dirname, '../../../src/rankings/__tests__/fixtures/gmapsItems.json'), 'utf8'))

function item(index: number, overrides: Partial<RawGmapsItem> = {}): RawGmapsItem {
  return { name: `店${index}`, href: `https://www.google.com/maps/place/x/data=!19sChIJ_${index}`, starLabel: '4.0 つ星 クチコミ 3 件', text: `店${index}\n店${index}\n4.0(3)\nカフェ・喫茶 · 渋谷`, isSponsored: false, ...overrides }
}

test('parseGmapsItems: 実画面の生データから順位・placeId・評価・口コミ数・カテゴリを取り出す', () => {
  const results = parseGmapsItems(fixture)
  assert.deepEqual(results[0], { rank: 1, placeId: 'ChIJJSXdAgCNGGARgXOQtMa-LCM', name: 'DUKE Cafe 渋谷神南店', rating: 4.1, reviewCount: 195, category: 'カフェ・喫茶' })
  assert.equal(results[1]!.placeId, 'ChIJRwSp3HiNGGARfZL0ETA7Eo4')
})

test('parseGmapsItems: 広告を除き、残りに 1 から順位を振る。重複（同じ placeId）は 1 件にする', () => {
  const results = parseGmapsItems(fixture)
  assert.deepEqual(results.map(result => result.name), ['DUKE Cafe 渋谷神南店', 'Nakaniwa URBAN COFFEE COURTYARD', 'yellow 渋谷', '新しいカフェ'])
  assert.deepEqual(results.map(result => result.rank), [1, 2, 3, 4])
})

test('parseGmapsItems: カンマ付きの口コミ数、評価なし、placeId なし', () => {
  const results = parseGmapsItems(fixture)
  assert.equal(results[2]!.reviewCount, 2123)
  assert.deepEqual(results[3], { rank: 4, placeId: null, name: '新しいカフェ', rating: null, reviewCount: null, category: 'コーヒーショップ・喫茶店' })
})

test('parseGmapsItems: 20 件で打ち切る。0 件は空配列', () => {
  assert.equal(parseGmapsItems(Array.from({ length: 30 }, (_, index) => item(index))).length, RANK_LIMIT)
  assert.equal(parseGmapsItems(Array.from({ length: 20 }, (_, index) => item(index)))[19]!.rank, 20)
  assert.deepEqual(parseGmapsItems([]), [])
})

test('parseGmapsItems: 店名が空のカードは無視する', () => {
  assert.equal(parseGmapsItems([item(1, { name: '  ' }), item(2)])[0]!.name, '店2')
})
```

`functions/src/rankings/__tests__/matchStore.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchStore, normalizeName } from '../matchStore'
import type { RankResult } from '../types'

function result(rank: number, name: string, placeId: string | null): RankResult {
  return { rank, placeId, name, rating: null, reviewCount: null, category: null }
}

const results = [result(1, 'あさひ食堂', 'p-1'), result(2, 'ＨＡＮＡＭＩ　渋谷店', null), result(3, 'こもれび', 'p-3')]

test('normalizeName: NFKC・空白除去・小文字化', () => {
  assert.equal(normalizeName('ＨＡＮＡＭＩ　渋谷店'), 'hanami渋谷店')
})

test('matchStore: placeId が一致すればその順位', () => {
  assert.deepEqual(matchStore(results, { placeId: 'p-3', name: '別名' }), { rank: 3, matchedBy: 'placeId' })
})

test('matchStore: placeId が取れなかった結果とは、正規化した店名で照合する', () => {
  assert.deepEqual(matchStore(results, { placeId: 'p-9', name: 'Hanami 渋谷店' }), { rank: 2, matchedBy: 'name' })
})

test('matchStore: placeId を持つ別の店舗とは、店名が同じでも一致させない', () => {
  assert.deepEqual(matchStore(results, { placeId: 'p-9', name: 'あさひ食堂' }), { rank: null, matchedBy: null })
})

test('matchStore: 一致なし・店舗なしは圏外', () => {
  assert.deepEqual(matchStore(results, { placeId: 'p-9', name: '無関係' }), { rank: null, matchedBy: null })
  assert.deepEqual(matchStore(results, null), { rank: null, matchedBy: null })
  assert.deepEqual(matchStore([], { placeId: 'p-1', name: 'あさひ食堂' }), { rank: null, matchedBy: null })
})

test('matchStore: 店舗の placeId が未設定（空文字）なら店名だけで照合する', () => {
  assert.deepEqual(matchStore(results, { placeId: '', name: 'hanami渋谷店' }), { rank: 2, matchedBy: 'name' })
})
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL（`Cannot find module '../providers/parseGmapsItems'`、`'../matchStore'`）

- [ ] **Step 5: 実装する**

`functions/src/rankings/providers/parseGmapsItems.ts`:

```ts
import type { RankResult } from '../types'
import type { RawGmapsItem } from './rankProvider'

/** 計測範囲（Google マップの 1 ページ目） */
export const RANK_LIMIT = 20

const PLACE_ID_PATTERN = /!19s(ChIJ[^!?&#]+)/
const RATING_PATTERN = /([\d.]+)\s*つ星/
const REVIEW_COUNT_PATTERN = /クチコミ\s*([\d,]+)\s*件/
/** 「4.1(195) · ￥1,000～2,000」のような評価の行 */
const RATING_LINE_PATTERN = /^\d(\.\d)?\s*\(/

function parseRating(label: string | null): number | null {
  const match = label?.match(RATING_PATTERN)
  return match ? Number(match[1]) : null
}

function parseReviewCount(label: string | null): number | null {
  const match = label?.match(REVIEW_COUNT_PATTERN)
  return match ? Number(match[1]!.replace(/,/g, '')) : null
}

/** 店名・評価の行を除いた最初の行の、「·」より前の部分 */
function parseCategory(text: string, name: string): string | null {
  const line = text.split('\n')
    .map(value => value.trim())
    .find(value => value !== '' && value !== name && !RATING_LINE_PATTERN.test(value) && !value.includes('クチコミ'))
  const category = line?.split('·')[0]?.trim()
  return category ? category : null
}

/** 画面の生データを順位順の RankResult[] にする。広告・重複・店名なしを除き、上位 20 件まで */
export function parseGmapsItems(items: RawGmapsItem[]): RankResult[] {
  const seen = new Set<string>()
  const results: RankResult[] = []
  for (const item of items) {
    const name = item.name.trim()
    if (item.isSponsored || name === '') continue
    const placeId = item.href.match(PLACE_ID_PATTERN)?.[1] ?? null
    const key = placeId ?? `name:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      rank: results.length + 1,
      placeId: placeId ? decodeURIComponent(placeId) : null,
      name,
      rating: parseRating(item.starLabel),
      reviewCount: parseReviewCount(item.starLabel),
      category: parseCategory(item.text, name),
    })
    if (results.length === RANK_LIMIT) break
  }
  return results
}
```

`functions/src/rankings/matchStore.ts`:

```ts
import type { MatchedBy, RankResult } from './types'

/** 店名の比較用（全角半角・空白・大文字小文字の差をなくす） */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/**
 * 自店の順位を探す。placeId を優先し、結果の placeId が取れなかったものに限って店名で照合する。
 * placeId を持つ別の店舗とは、店名が同じでも一致させない。
 */
export function matchStore(
  results: RankResult[],
  store: { placeId: string | null; name: string } | null,
): { rank: number | null; matchedBy: MatchedBy } {
  if (!store) return { rank: null, matchedBy: null }
  if (store.placeId) {
    const hit = results.find(result => result.placeId === store.placeId)
    if (hit) return { rank: hit.rank, matchedBy: 'placeId' }
  }
  const target = normalizeName(store.name)
  const byName = target === '' ? undefined : results.find(result => result.placeId === null && normalizeName(result.name) === target)
  return byName ? { rank: byName.rank, matchedBy: 'name' } : { rank: null, matchedBy: null }
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm --prefix functions test`
Expected: PASS

- [ ] **Step 7: 確認**

Run: `git status --short functions/src/rankings`
Expected: Task 1・2 のファイルが表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 3: Firestore ルールとインデックス

**Files:**
- Modify: `firestore.rules`（`match /replyTemplates/{templateId}` の後ろに追加）
- Modify: `firestore.indexes.json`
- Test: `functions/src/__tests__/firestore.rules.itest.ts`

**Interfaces:**
- Produces: 読み取りの規則。`rankKeywords` / `rankSnapshots` / `rankResults` はメンバーが読める（staff は `storeId` が担当店舗のもののみ）。`rankSearches` は owner / admin のみ、`usageMonthly` はメンバー。`rankRuns` は全員拒否。

- [ ] **Step 1: 失敗するテストを書く**

`firestore.rules.itest.ts` の `beforeEach` 内、`replyTemplates/t-1` を書く行の後ろに追加する:

```ts
    await setDoc(doc(db, 'organizations/org-a/rankKeywords/kw-1'), { orgId: 'org-a', storeId: 'st-1', keyword: '渋谷 カフェ' })
    await setDoc(doc(db, 'organizations/org-a/rankKeywords/kw-2'), { orgId: 'org-a', storeId: 'st-2', keyword: '新宿 カフェ' })
    await setDoc(doc(db, 'organizations/org-a/rankSnapshots/kw-1_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-1', storeId: 'st-1', checkedOn: '2026-10-08' })
    await setDoc(doc(db, 'organizations/org-a/rankSnapshots/kw-2_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-2', storeId: 'st-2', checkedOn: '2026-10-08' })
    await setDoc(doc(db, 'organizations/org-a/rankResults/kw-1_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-1', storeId: 'st-1', results: [] })
    await setDoc(doc(db, 'organizations/org-a/rankResults/kw-2_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-2', storeId: 'st-2', results: [] })
    await setDoc(doc(db, 'organizations/org-a/rankSearches/rs-1'), { orgId: 'org-a', keyword: '渋谷 カフェ', storeId: null })
    await setDoc(doc(db, 'organizations/org-a/usageMonthly/202610'), { orgId: 'org-a', rankChecks: 3 })
    await setDoc(doc(db, 'rankRuns/2026-10-08'), { done: 1, blocked: 0 })
```

ファイル末尾に追加する:

```ts
test('rankKeywords / rankSnapshots / rankResults: owner は全店舗、staff は担当店舗だけ。書き込みは不可', async () => {
  for (const path of ['organizations/org-a/rankKeywords', 'organizations/org-a/rankSnapshots', 'organizations/org-a/rankResults']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/rankResults/kw-1_2026-10-08')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/rankResults/kw-2_2026-10-08')))
  await assertSucceeds(getDocs(query(collection(as('u-staff'), 'organizations/org-a/rankSnapshots'), where('storeId', 'in', ['st-1']), where('checkedOn', '>=', '2026-07-01'))))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/rankKeywords/kw-3'), { orgId: 'org-a', storeId: 'st-1' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/rankSnapshots/kw-1_2026-10-08'), { rank: 1 }))
})

test('rankSearches は owner / admin のみ、usageMonthly はメンバー、rankRuns は誰も読めない', async () => {
  await assertSucceeds(getDocs(collection(as('u-owner'), 'organizations/org-a/rankSearches')))
  await assertSucceeds(getDoc(doc(as('u-admin'), 'organizations/org-a/rankSearches/rs-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/rankSearches/rs-1')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/rankSearches/rs-2'), { orgId: 'org-a' }))
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/usageMonthly/202610')))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a/usageMonthly/202610')))
  await assertFails(getDoc(doc(as('u-owner'), 'rankRuns/2026-10-08')))
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL。新しい 2 テストの `assertSucceeds` が `PERMISSION_DENIED` で失敗する。

- [ ] **Step 3: ルールを追加する**

`firestore.rules` の `match /replyTemplates/{templateId} { ... }` の直後（`match /organizations/{orgId}` の内側）に追加する:

```
      // 順位計測（書き込みは Functions のみ）。staff は storeId in [担当店舗] で絞り込めば一覧も読める
      match /rankKeywords/{keywordId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /rankSnapshots/{snapshotId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /rankResults/{resultId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      // その場計測は owner / admin だけの機能
      match /rankSearches/{searchId} {
        allow read: if hasRole(orgId, ['owner', 'admin']);
      }

      match /usageMonthly/{month} {
        allow read: if isMember(orgId);
      }
```

ファイル冒頭のコメント `// docs/02-database.md 5 章のうち、基盤（組織・メンバー・招待・連携・店舗）の読み取り規則。` を `// docs/02-database.md 5 章のうち、基盤（組織・メンバー・招待・連携・店舗）・GBP・順位計測の読み取り規則。` に変える。

- [ ] **Step 4: インデックスを追加する**

`firestore.indexes.json` の `indexes` 配列の末尾に追加する（staff の購読 `storeId in` ＋ `checkedOn >=` 用）:

```json
    {
      "collectionGroup": "rankSnapshots",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "storeId", "order": "ASCENDING" },
        { "fieldPath": "checkedOn", "order": "ASCENDING" }
      ]
    }
```

`fieldOverrides` 配列の末尾に追加する（日次計測で `collectionGroup('rankKeywords').where('isActive', '==', true)` を使うため）:

```json
    {
      "collectionGroup": "rankKeywords",
      "fieldPath": "isActive",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（既存のルールテスト・結合テストも PASS）

- [ ] **Step 6: 確認**

Run: `git diff --stat firestore.rules firestore.indexes.json functions/src/__tests__/firestore.rules.itest.ts`
Expected: 3 ファイルに追加分だけの差分が出る。コミットはユーザーの許可がある場合のみ行う。

---

### Task 4: 依存の差し替え口・使用回数・ワーカー

**Files:**
- Create: `functions/src/rankings/rankDeps.ts`
- Create: `functions/src/rankings/usage.ts`
- Create: `functions/src/rankings/worker.ts`
- Create: `functions/src/rankings/__tests__/fakeRank.ts`
- Test: `functions/src/rankings/__tests__/worker.itest.ts`

**Interfaces:**
- Consumes:
  - Task 1：`RankTask` / `RankResult` / `RankErrorCode` / `SearchLocation`
  - Task 2：`RankProvider` / `RankProviderError` / `matchStore`
- Produces:
  - `interface EnqueueOptions { id: string }`
  - `interface RankDeps { provider: RankProvider; enqueue(task: RankTask, options: EnqueueOptions): Promise<void>; now(): Date }`
  - `defaultRankDeps: RankDeps`
  - `reserveRankChecks(tx: Transaction, db: Firestore, orgId: string, limit: number, count: number, now: Date): Promise<number>`
  - `releaseRankChecks(db: Firestore, orgId: string, now: Date, count: number): Promise<void>`
  - `RANK_MAX_ATTEMPTS = 3`
  - `parseRankTask(data: unknown): RankTask`
  - `runRankTask(db: Firestore, task: RankTask, deps: RankDeps, attempt: { isFinalAttempt: boolean }): Promise<void>`
  - テスト用：`createFakeRankDeps(initial?: RankResult[] | Error)` が返す `{ deps, enqueued, setResults(value), setNow(date), searchCalls }`、`sampleResults(count: number, own?: { rank: number; placeId: string }): RankResult[]`

- [ ] **Step 1: 依存と使用回数を作る**

`functions/src/rankings/rankDeps.ts`:

```ts
import { getFunctions } from 'firebase-admin/functions'
import type { RankProvider } from './providers/rankProvider'
import type { RankTask } from './types'

// 順位計測の外部依存（Google マップの取得・Cloud Tasks への投入・現在時刻）。テストでは偽物に差し替える

export interface EnqueueOptions {
  /** Cloud Tasks のタスク名。同じ名前の再投入は無視される（冪等） */
  id: string
}

export interface RankDeps {
  provider: RankProvider
  enqueue(task: RankTask, options: EnqueueOptions): Promise<void>
  now(): Date
}

const WORKER_QUEUE = 'locations/asia-northeast1/functions/rankCheckWorker'

export const defaultRankDeps: RankDeps = {
  provider: {
    // Chromium はワーカーだけで読み込む（callable の起動を重くしない）
    async search(keyword, at) {
      const { gmapsProvider } = await import('./providers/gmapsScraper')
      return gmapsProvider.search(keyword, at)
    },
  },
  async enqueue(task, options) {
    try {
      await getFunctions().taskQueue<RankTask>(WORKER_QUEUE).enqueue(task, { id: options.id })
    }
    catch (error) {
      if ((error as { code?: string }).code === 'functions/task-already-exists') return
      throw error
    }
  },
  now: () => new Date(),
}
```

`./providers/gmapsScraper` は Task 7 で本体を書く。`tsc` を通すため、Step 2 で先に雛形を置く。

- [ ] **Step 2: スクレイパーの雛形を作る（Task 7 で中身を書く）**

`functions/src/rankings/providers/gmapsScraper.ts`（Task 7 で全体を置き換える）:

```ts
import { RankProviderError, type RankProvider } from './rankProvider'

// Task 7 で Puppeteer の実装に置き換える
export const gmapsProvider: RankProvider = {
  async search() {
    throw new RankProviderError('parse', 'gmapsScraper は未実装です')
  },
}
```

`functions/src/rankings/usage.ts`:

```ts
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { toJstMonthKey } from './validation'

// 今月の順位計測回数（organizations/{orgId}/usageMonthly/{YYYYMM}.rankChecks）。受け付けた時点で数える

function usageRef(db: Firestore, orgId: string, month: string) {
  return db.doc(`organizations/${orgId}/usageMonthly/${month}`)
}

/** 上限まで count 件を予約し、予約できた件数を返す。トランザクション内の読み取りの後、書き込みの前に呼ぶ */
export async function reserveRankChecks(tx: Transaction, db: Firestore, orgId: string, limit: number, count: number, now: Date): Promise<number> {
  const month = toJstMonthKey(now)
  const ref = usageRef(db, orgId, month)
  const used = ((await tx.get(ref)).get('rankChecks') as number | undefined) ?? 0
  const granted = Math.max(0, Math.min(count, limit - used))
  if (granted > 0) tx.set(ref, { orgId, month, rankChecks: FieldValue.increment(granted) }, { merge: true })
  return granted
}

/** 投入に失敗したときに予約を戻す */
export async function releaseRankChecks(db: Firestore, orgId: string, now: Date, count: number): Promise<void> {
  await usageRef(db, orgId, toJstMonthKey(now)).set({ rankChecks: FieldValue.increment(-count) }, { merge: true })
}
```

`functions/src/rankings/__tests__/fakeRank.ts`:

```ts
import type { EnqueueOptions, RankDeps } from '../rankDeps'
import type { RankResult, RankTask } from '../types'

/** 上位 count 件の結果。own を渡すとその順位に自店を置く */
export function sampleResults(count: number, own?: { rank: number; placeId: string }): RankResult[] {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1
    const isOwn = own?.rank === rank
    return { rank, placeId: isOwn ? own.placeId : `p-${rank}`, name: isOwn ? '自店' : `競合${rank}`, rating: 4, reviewCount: 10 * rank, category: 'カフェ・喫茶' }
  })
}

export function createFakeRankDeps(initial: RankResult[] | Error = []) {
  const enqueued: { task: RankTask; options: EnqueueOptions }[] = []
  const searchCalls: { keyword: string; at: { lat: number; lng: number } }[] = []
  let results = initial
  let current = new Date('2026-10-08T01:00:00Z') // JST 2026-10-08 10:00
  let enqueueError: Error | null = null
  const deps: RankDeps = {
    provider: {
      async search(keyword, at) {
        searchCalls.push({ keyword, at })
        if (results instanceof Error) throw results
        return results
      },
    },
    async enqueue(task, options) {
      if (enqueueError) throw enqueueError
      // Cloud Tasks と同じく、同じ ID の再投入は無視する
      if (enqueued.some(item => item.options.id === options.id)) return
      enqueued.push({ task, options })
    },
    now: () => current,
  }
  return {
    deps,
    enqueued,
    searchCalls,
    setResults(value: RankResult[] | Error) { results = value },
    setNow(date: Date) { current = date },
    setEnqueueError(error: Error | null) { enqueueError = error },
  }
}
```

- [ ] **Step 3: 失敗するテストを書く**

`functions/src/rankings/__tests__/worker.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { RankProviderError } from '../providers/rankProvider'
import { parseRankTask, runRankTask } from '../worker'
import { createFakeRankDeps, sampleResults } from './fakeRank'

const db = getTestDb()
const FINAL = { isFinalAttempt: true }
const NOT_FINAL = { isFinalAttempt: false }
const DAY = '2026-10-08'
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

async function seedKeyword(overrides: Record<string, unknown> = {}) {
  await db.doc('organizations/org-a/stores/st-1').set({ orgId: 'org-a', name: '自店', status: 'active', placeId: 'own-place' })
  await db.doc('organizations/org-a/rankKeywords/kw-1').set({
    orgId: 'org-a', storeId: 'st-1', keyword: '渋谷 カフェ', searchLocation: LOCATION, isActive: true,
    createdBy: 'u-owner', createdAt: new Date(), pendingCheckAt: new Date(), lastManualCheckAt: null, ...overrides,
  })
}

const keywordTask = (trigger: 'scheduled' | 'manual' = 'scheduled') => ({ kind: 'keyword' as const, orgId: 'org-a', keywordId: 'kw-1', trigger, checkedOn: DAY })
const snapshotDoc = () => db.doc(`organizations/org-a/rankSnapshots/kw-1_${DAY}`).get()
const resultsDoc = () => db.doc(`organizations/org-a/rankResults/kw-1_${DAY}`).get()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
})

test('parseRankTask: 種類ごとに検証し、不正な形は invalid-argument', () => {
  assert.deepEqual(parseRankTask(keywordTask()), keywordTask())
  assert.deepEqual(parseRankTask({ kind: 'search', orgId: 'org-a', searchId: 'rs-1' }), { kind: 'search', orgId: 'org-a', searchId: 'rs-1' })
  assert.throws(() => parseRankTask({ kind: 'x', orgId: 'org-a' }), { code: 'invalid-argument' })
  assert.throws(() => parseRankTask({ ...keywordTask(), checkedOn: '2026/10/08' }), { code: 'invalid-argument' })
})

test('runRankTask(keyword): 取得・照合してスナップショットと結果を保存し、計測中を解除する', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 3, placeId: 'own-place' }))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)

  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('rank'), 3)
  assert.equal(snapshot.get('status'), 'ok')
  assert.equal(snapshot.get('matchedBy'), 'placeId')
  assert.equal(snapshot.get('resultCount'), 20)
  assert.equal(snapshot.get('storeId'), 'st-1')
  assert.equal(snapshot.get('provider'), 'gmaps-scraper')
  assert.equal((await resultsDoc()).get('results').length, 20)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
  assert.deepEqual(fake.searchCalls, [{ keyword: '渋谷 カフェ', at: LOCATION }])
})

test('runRankTask(keyword): 同じタスクを 2 回実行してもスナップショットは 1 件', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 5, placeId: 'own-place' }))
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  const snapshots = await db.collection('organizations/org-a/rankSnapshots').get()
  assert.equal(snapshots.size, 1)
  assert.equal((await db.doc(`rankRuns/${DAY}`).get()).get('done'), 2)
})

test('runRankTask(keyword): 21 位以下・一致なしは圏外（rank: null）で ok', async () => {
  await seedKeyword()
  await runRankTask(db, keywordTask(), createFakeRankDeps(sampleResults(20)).deps, FINAL)
  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('status'), 'ok')
  assert.equal(snapshot.get('rank'), null)
})

test('runRankTask(keyword): 最後の試行でなければ例外を投げて再試行に回し、何も保存しない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(new RankProviderError('blocked', 'sorry'))
  await assert.rejects(runRankTask(db, keywordTask(), fake.deps, NOT_FINAL), { name: 'RankProviderError' })
  assert.equal((await snapshotDoc()).exists, false)
})

test('runRankTask(keyword): 最後の試行で失敗したら error を保存する（結果は書かない）', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(new RankProviderError('timeout', 'slow'))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  const snapshot = await snapshotDoc()
  assert.equal(snapshot.get('status'), 'error')
  assert.equal(snapshot.get('errorCode'), 'timeout')
  assert.equal(snapshot.get('rank'), null)
  assert.equal((await resultsDoc()).exists, false)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
})

test('runRankTask(keyword): 想定外の例外は parse として保存する', async () => {
  await seedKeyword()
  await runRankTask(db, keywordTask(), createFakeRankDeps(new Error('boom')).deps, FINAL)
  assert.equal((await snapshotDoc()).get('errorCode'), 'parse')
})

test('runRankTask(keyword): 同じ日の ok は error で上書きしない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20, { rank: 2, placeId: 'own-place' }))
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  fake.setResults(new RankProviderError('blocked', 'sorry'))
  await db.doc('organizations/org-a/rankKeywords/kw-1').update({ pendingCheckAt: new Date() })
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await snapshotDoc()).get('status'), 'ok')
  assert.equal((await snapshotDoc()).get('rank'), 2)
  assert.equal((await resultsDoc()).exists, true)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).get('pendingCheckAt'), null)
})

test('runRankTask(keyword): キーワードが削除済み、または日次で停止中なら何もしない（キーワードを作り直さない）', async () => {
  const fake = createFakeRankDeps(sampleResults(20))
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).exists, false)
  await seedKeyword({ isActive: false })
  await runRankTask(db, keywordTask('scheduled'), fake.deps, FINAL)
  assert.equal((await snapshotDoc()).exists, false)
  assert.equal(fake.searchCalls.length, 0)
})

test('runRankTask(keyword): 取得中にキーワードが削除されても、キーワードを作り直さない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps()
  fake.deps.provider = {
    async search() {
      await db.doc('organizations/org-a/rankKeywords/kw-1').delete()
      return sampleResults(20)
    },
  }
  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankKeywords/kw-1').get()).exists, false)
})

test('runRankTask(keyword): ブロックが続いた日は、日次のタスクを取得せずに error / blocked で終える（手動は対象外）', async () => {
  await seedKeyword()
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 5, blocked: 10 })
  const fake = createFakeRankDeps(sampleResults(20, { rank: 1, placeId: 'own-place' }))
  await runRankTask(db, keywordTask('scheduled'), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 0)
  assert.equal((await snapshotDoc()).get('errorCode'), 'blocked')
  assert.ok((await db.doc(`rankRuns/${DAY}`).get()).get('cutOffAt'))

  await runRankTask(db, keywordTask('manual'), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 1)
  assert.equal((await snapshotDoc()).get('rank'), 1)
})

test('runRankTask(keyword): ブロックが 10 件未満、または割合が 30% 以下なら打ち切らない', async () => {
  await seedKeyword()
  const fake = createFakeRankDeps(sampleResults(20))
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 0, blocked: 9 })
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  await db.doc(`rankRuns/${DAY}`).set({ day: DAY, done: 30, blocked: 10 })
  await runRankTask(db, keywordTask(), fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 2)
})

test('runRankTask(search): queued → done。店舗を指定していれば自店の順位を出す', async () => {
  await db.doc('organizations/org-a/stores/st-1').set({ orgId: 'org-a', name: '自店', status: 'active', placeId: 'own-place' })
  await db.doc('organizations/org-a/rankSearches/rs-1').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: 'st-1', status: 'queued', results: [] })
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, createFakeRankDeps(sampleResults(20, { rank: 7, placeId: 'own-place' })).deps, FINAL)
  const search = await db.doc('organizations/org-a/rankSearches/rs-1').get()
  assert.equal(search.get('status'), 'done')
  assert.equal(search.get('rank'), 7)
  assert.equal(search.get('results').length, 20)
  assert.ok(search.get('finishedAt'))
})

test('runRankTask(search): 店舗なしは rank: null。完了済みは再実行しない。最後の試行の失敗は error', async () => {
  await db.doc('organizations/org-a/rankSearches/rs-1').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null, status: 'queued', results: [] })
  const fake = createFakeRankDeps(sampleResults(20))
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, fake.deps, FINAL)
  assert.equal((await db.doc('organizations/org-a/rankSearches/rs-1').get()).get('rank'), null)
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-1' }, fake.deps, FINAL)
  assert.equal(fake.searchCalls.length, 1)

  await db.doc('organizations/org-a/rankSearches/rs-2').set({ orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null, status: 'queued', results: [] })
  fake.setResults(new RankProviderError('blocked', 'sorry'))
  await assert.rejects(runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-2' }, fake.deps, NOT_FINAL))
  assert.equal((await db.doc('organizations/org-a/rankSearches/rs-2').get()).get('status'), 'running')
  await runRankTask(db, { kind: 'search', orgId: 'org-a', searchId: 'rs-2' }, fake.deps, FINAL)
  const failed = await db.doc('organizations/org-a/rankSearches/rs-2').get()
  assert.equal(failed.get('status'), 'error')
  assert.equal(failed.get('errorCode'), 'blocked')
})
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../worker'`）

- [ ] **Step 5: ワーカーを実装する**

`functions/src/rankings/worker.ts`:

```ts
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
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm --prefix functions run build && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: `tsc` がエラーなく終わる。`worker.itest.ts` を含めすべて PASS。

- [ ] **Step 7: 確認**

Run: `git status --short functions/src/rankings`
Expected: `rankDeps.ts`、`usage.ts`、`worker.ts`、`providers/gmapsScraper.ts`（雛形）、`__tests__/fakeRank.ts`、`__tests__/worker.itest.ts` が増えている。コミットはユーザーの許可がある場合のみ行う。

---

### Task 5: 日次計測の投入

**Files:**
- Create: `functions/src/rankings/scheduled.ts`
- Test: `functions/src/rankings/__tests__/scheduled.itest.ts`

**Interfaces:**
- Consumes:
  - Task 4：`RankDeps` / `defaultRankDeps` / `reserveRankChecks`
  - Task 1：`toJstDayKey`
  - 既存：`orgRef`
- Produces: `runScheduledRankCheck(db: Firestore, deps?: RankDeps): Promise<{ enqueued: number; skippedOrgs: number }>`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/rankings/__tests__/scheduled.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { runScheduledRankCheck } from '../scheduled'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

async function seedKeyword(orgId: string, keywordId: string, isActive = true) {
  await db.doc(`organizations/${orgId}/rankKeywords/${keywordId}`).set({ orgId, storeId: 'st-1', keyword: '渋谷 カフェ', searchLocation: LOCATION, isActive })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-x', role: 'owner' }] })
})

test('runScheduledRankCheck: 有効なキーワードだけを投入し、使用回数を数える（停止中の組織は除く）', async () => {
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-a', 'kw-2')
  await seedKeyword('org-a', 'kw-off', false)
  await seedKeyword('org-stop', 'kw-s')
  const fake = createFakeRankDeps()

  const summary = await runScheduledRankCheck(db, fake.deps)

  assert.deepEqual(summary, { enqueued: 2, skippedOrgs: 0 })
  assert.deepEqual(fake.enqueued.map(item => item.options.id).sort(), ['org-a-kw-1-2026-10-08', 'org-a-kw-2-2026-10-08'])
  for (const { task } of fake.enqueued) {
    assert.equal(task.kind, 'keyword')
    assert.equal(task.kind === 'keyword' && task.trigger, 'scheduled')
    assert.equal(task.kind === 'keyword' && task.checkedOn, '2026-10-08')
  }
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 2)
})

test('runScheduledRankCheck: 同じ日に 2 回起動しても、使用回数とタスクは増えない', async () => {
  await seedKeyword('org-a', 'kw-1')
  const fake = createFakeRankDeps()
  await runScheduledRankCheck(db, fake.deps)
  await runScheduledRankCheck(db, fake.deps)
  assert.equal(fake.enqueued.length, 1)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)
})

test('runScheduledRankCheck: 月の上限を超える分は投入しない', async () => {
  await seedKeyword('org-a', 'kw-1')
  await seedKeyword('org-a', 'kw-2')
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', rankChecks: 2999 })
  const fake = createFakeRankDeps()
  const summary = await runScheduledRankCheck(db, fake.deps)
  assert.deepEqual(summary, { enqueued: 1, skippedOrgs: 1 })
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 3000)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../scheduled'`）

- [ ] **Step 3: 実装する**

`functions/src/rankings/scheduled.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'
import { orgRef } from '../shared/members'
import { defaultRankDeps, type RankDeps } from './rankDeps'
import { reserveRankChecks } from './usage'
import { toJstDayKey } from './validation'

// scheduledRankCheck の本体。有効なキーワードを組織ごとに予約してから投入する。
// 投入の間隔は rankCheckWorker の rateLimits（maxDispatchesPerSecond）で空ける

/**
 * 組織の今日の予約件数を 1 回だけ決める（Cloud Scheduler の再実行で二重に数えない）。
 * 利用停止中・削除済みの組織は null
 */
async function grantForOrg(db: Firestore, orgId: string, wanted: number, day: string, now: Date): Promise<number | null> {
  return db.runTransaction(async (tx) => {
    const runRef = db.doc(`rankRuns/${day}/orgs/${orgId}`)
    const [run, org] = await Promise.all([tx.get(runRef), tx.get(orgRef(db, orgId))])
    if (!org.exists || org.get('status') !== 'active') return null
    if (run.exists) return run.get('granted') as number
    const granted = await reserveRankChecks(tx, db, orgId, org.get('limits.monthlyRankChecks') as number, wanted, now)
    tx.set(runRef, { orgId, granted, wanted })
    return granted
  })
}

export async function runScheduledRankCheck(db: Firestore, deps: RankDeps = defaultRankDeps): Promise<{ enqueued: number; skippedOrgs: number }> {
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
  for (const [orgId, keywordIds] of keywordIdsByOrg) {
    const granted = await grantForOrg(db, orgId, keywordIds.length, checkedOn, now)
    if (granted === null) continue
    // 月の上限で一部（または全部）を計測できなかった組織
    if (granted < keywordIds.length) skippedOrgs++
    for (const keywordId of keywordIds.slice(0, granted)) {
      await deps.enqueue({ kind: 'keyword', orgId, keywordId, trigger: 'scheduled', checkedOn }, { id: `${orgId}-${keywordId}-${checkedOn}` })
      enqueued++
    }
  }
  return { enqueued, skippedOrgs }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS。2 回目の起動では、`rankRuns/{day}/orgs/{orgId}` が予約済みの件数を返し、タスク ID の重複も無視される。

- [ ] **Step 5: 確認**

Run: `git status --short functions/src/rankings`
Expected: `scheduled.ts` と `__tests__/scheduled.itest.ts` が増えている。コミットはユーザーの許可がある場合のみ行う。

---

### Task 6: callable（キーワード・手動計測・その場計測）と export

**Files:**
- Create: `functions/src/rankings/keywords.ts`
- Create: `functions/src/rankings/searches.ts`
- Modify: `functions/src/index.ts`（import と export を追加）
- Test: `functions/src/rankings/__tests__/keywords.itest.ts`、`functions/src/rankings/__tests__/searches.itest.ts`

**Interfaces:**
- Consumes:
  - Task 1：`requireKeyword` / `requireSearchLocation` / `toJstDayKey`
  - Task 4：`RankDeps` / `defaultRankDeps` / `reserveRankChecks` / `releaseRankChecks` / `RANK_MAX_ATTEMPTS` / `parseRankTask` / `runRankTask`
  - Task 5：`runScheduledRankCheck`
- Produces:
  - `createRankKeywordFunc(db, caller, data, deps?) => Promise<{ id: string; keyword: string; isChecking: boolean }>`
    - data: `{ orgId, storeId, keyword, searchLocation: { lat, lng, label } }`
  - `updateRankKeywordActiveFunc(db, caller, data) => Promise<void>`
    - data: `{ orgId, keywordId, isActive: boolean }`
  - `deleteRankKeywordFunc(db, caller, data) => Promise<void>`
    - data: `{ orgId, keywordId }`
  - `postRankCheckFunc(db, caller, data, deps?) => Promise<void>`
    - data: `{ orgId, keywordId }`
  - `createRankSearchFunc(db, caller, data, deps?) => Promise<{ id: string }>`
    - data: `{ orgId, keyword, searchLocation, storeId: string | null }`
  - export 名：`createRankKeyword` / `updateRankKeywordActive` / `deleteRankKeyword` / `postRankCheck` / `createRankSearch` / `rankCheckWorker` / `scheduledRankCheck`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/rankings/__tests__/keywords.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { createRankKeywordFunc, deleteRankKeywordFunc, postRankCheckFunc, updateRankKeywordActiveFunc } from '../keywords'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const OWNER = caller('u-owner')
const STAFF = caller('u-staff')
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }
const input = (overrides: Record<string, unknown> = {}) => ({ orgId: 'org-a', storeId: 'st-1', keyword: '渋谷　カフェ', searchLocation: LOCATION, ...overrides })
const usage = async () => (await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
})

test('createRankKeyword: 正規化して登録し、初回の手動計測を投入する', async () => {
  const fake = createFakeRankDeps()
  const created = await createRankKeywordFunc(db, OWNER, input(), fake.deps)

  assert.equal(created.keyword, '渋谷 カフェ')
  assert.equal(created.isChecking, true)
  const keyword = await db.doc(`organizations/org-a/rankKeywords/${created.id}`).get()
  assert.equal(keyword.get('keyword'), '渋谷 カフェ')
  assert.equal(keyword.get('isActive'), true)
  assert.deepEqual(keyword.get('searchLocation'), LOCATION)
  assert.ok(keyword.get('pendingCheckAt'))
  assert.equal(fake.enqueued.length, 1)
  assert.deepEqual(fake.enqueued[0]!.task, { kind: 'keyword', orgId: 'org-a', keywordId: created.id, trigger: 'manual', checkedOn: '2026-10-08' })
  assert.equal(await usage(), 1)
})

test('createRankKeyword: staff・存在しない店舗・短いキーワード・重複・上限は拒否', async () => {
  const fake = createFakeRankDeps()
  await assert.rejects(createRankKeywordFunc(db, STAFF, input(), fake.deps), { code: 'permission-denied' })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ storeId: 'st-9' }), fake.deps), { code: 'not-found' })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋' }), fake.deps), { code: 'invalid-argument' })
  await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋谷 カフェ' }), fake.deps), { code: 'already-exists' })
  // 地点が違えば別のキーワード
  await createRankKeywordFunc(db, OWNER, input({ searchLocation: { ...LOCATION, lat: 35.7 } }), fake.deps)
  await db.doc('organizations/org-a').update({ 'limits.maxKeywords': 2 })
  await assert.rejects(createRankKeywordFunc(db, OWNER, input({ keyword: '渋谷 ランチ' }), fake.deps), { code: 'resource-exhausted' })
})

test('createRankKeyword: 月の上限に達していれば登録だけして計測しない', async () => {
  await db.doc('organizations/org-a/usageMonthly/202610').set({ orgId: 'org-a', month: '202610', rankChecks: 3000 })
  const fake = createFakeRankDeps()
  const created = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  assert.equal(created.isChecking, false)
  assert.equal(fake.enqueued.length, 0)
  assert.equal((await db.doc(`organizations/org-a/rankKeywords/${created.id}`).get()).get('pendingCheckAt'), null)
})

test('createRankKeyword: 投入に失敗したら使用回数を戻し、計測中を解除して unavailable', async () => {
  const fake = createFakeRankDeps()
  fake.setEnqueueError(new Error('queue down'))
  await assert.rejects(createRankKeywordFunc(db, OWNER, input(), fake.deps), { code: 'unavailable' })
  assert.equal(await usage(), 0)
  const keywords = await db.collection('organizations/org-a/rankKeywords').get()
  assert.equal(keywords.docs[0]!.get('pendingCheckAt'), null)
})

test('postRankCheck: 1 時間に 1 回まで。停止中は不可。上限に達していれば不可', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'resource-exhausted', message: '手動計測は同じキーワードにつき 1 時間に 1 回までです。' })

  fake.setNow(new Date('2026-10-08T02:00:01Z'))
  await postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps)
  assert.equal(fake.enqueued.length, 2)
  assert.equal(await usage(), 2)

  await updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: false })
  fake.setNow(new Date('2026-10-08T04:00:00Z'))
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'failed-precondition' })

  await updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: true })
  await db.doc('organizations/org-a/usageMonthly/202610').update({ rankChecks: 3000 })
  await assert.rejects(postRankCheckFunc(db, OWNER, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'resource-exhausted', message: '今月の順位計測数の上限に達しています。' })
  await assert.rejects(postRankCheckFunc(db, STAFF, { orgId: 'org-a', keywordId: id }, fake.deps), { code: 'permission-denied' })
})

test('updateRankKeywordActive / deleteRankKeyword: owner / admin のみ。削除はスナップショットと結果も消す', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankKeywordFunc(db, OWNER, input(), fake.deps)
  await db.doc(`organizations/org-a/rankSnapshots/${id}_2026-10-08`).set({ orgId: 'org-a', keywordId: id, storeId: 'st-1' })
  await db.doc(`organizations/org-a/rankResults/${id}_2026-10-08`).set({ orgId: 'org-a', keywordId: id, storeId: 'st-1', results: [] })
  await db.doc('organizations/org-a/rankSnapshots/other_2026-10-08').set({ orgId: 'org-a', keywordId: 'other', storeId: 'st-1' })

  await assert.rejects(updateRankKeywordActiveFunc(db, STAFF, { orgId: 'org-a', keywordId: id, isActive: false }), { code: 'permission-denied' })
  await assert.rejects(updateRankKeywordActiveFunc(db, OWNER, { orgId: 'org-a', keywordId: id, isActive: 'no' }), { code: 'invalid-argument' })
  await assert.rejects(deleteRankKeywordFunc(db, STAFF, { orgId: 'org-a', keywordId: id }), { code: 'permission-denied' })
  await assert.rejects(deleteRankKeywordFunc(db, OWNER, { orgId: 'org-a', keywordId: 'none' }), { code: 'not-found' })

  await deleteRankKeywordFunc(db, OWNER, { orgId: 'org-a', keywordId: id })
  assert.equal((await db.doc(`organizations/org-a/rankKeywords/${id}`).get()).exists, false)
  assert.equal((await db.doc(`organizations/org-a/rankSnapshots/${id}_2026-10-08`).get()).exists, false)
  assert.equal((await db.doc(`organizations/org-a/rankResults/${id}_2026-10-08`).get()).exists, false)
  assert.equal((await db.doc('organizations/org-a/rankSnapshots/other_2026-10-08').get()).exists, true)
})
```

`functions/src/rankings/__tests__/searches.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg, seedStore } from '../../__tests__/emulator'
import { createRankSearchFunc } from '../searches'
import { createFakeRankDeps } from './fakeRank'

const db = getTestDb()
const OWNER = caller('u-owner')
const LOCATION = { lat: 35.664, lng: 139.698, label: '東京都渋谷区' }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
  await seedStore(db, 'org-a', 'st-1', '渋谷店')
})

test('createRankSearch: queued で作成し、30 日後に消える expireAt を付けて投入する', async () => {
  const fake = createFakeRankDeps()
  const { id } = await createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: ' 渋谷　カフェ ', searchLocation: LOCATION, storeId: 'st-1' }, fake.deps)

  const search = await db.doc(`organizations/org-a/rankSearches/${id}`).get()
  assert.equal(search.get('status'), 'queued')
  assert.equal(search.get('keyword'), '渋谷 カフェ')
  assert.equal(search.get('storeId'), 'st-1')
  assert.equal(search.get('createdBy'), 'u-owner')
  assert.equal(search.get('expireAt').toDate().toISOString(), '2026-11-07T01:00:00.000Z')
  assert.deepEqual(fake.enqueued, [{ task: { kind: 'search', orgId: 'org-a', searchId: id }, options: { id: `search-${id}` } }])
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)
})

test('createRankSearch: 店舗は任意。staff・存在しない店舗・上限は拒否。投入失敗は error にして unavailable', async () => {
  const fake = createFakeRankDeps()
  await createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps)
  await assert.rejects(createRankSearchFunc(db, caller('u-staff'), { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'permission-denied' })
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: 'st-9' }, fake.deps), { code: 'not-found' })

  fake.setEnqueueError(new Error('queue down'))
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'unavailable' })
  const failed = (await db.collection('organizations/org-a/rankSearches').where('status', '==', 'error').get()).docs
  assert.equal(failed.length, 1)
  assert.equal((await db.doc('organizations/org-a/usageMonthly/202610').get()).get('rankChecks'), 1)

  fake.setEnqueueError(null)
  await db.doc('organizations/org-a/usageMonthly/202610').update({ rankChecks: 3000 })
  await assert.rejects(createRankSearchFunc(db, OWNER, { orgId: 'org-a', keyword: '渋谷 カフェ', searchLocation: LOCATION, storeId: null }, fake.deps), { code: 'resource-exhausted' })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../keywords'`、`'../searches'`）

- [ ] **Step 3: キーワードの callable を実装する**

`functions/src/rankings/keywords.ts`:

```ts
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

/** 手動計測を投入する。失敗したら予約と計測中を戻す */
async function enqueueManualCheck(db: Firestore, deps: RankDeps, orgId: string, keywordId: string, now: Date): Promise<void> {
  try {
    await deps.enqueue({ kind: 'keyword', orgId, keywordId, trigger: 'manual', checkedOn: toJstDayKey(now) }, { id: `${keywordId}-manual-${now.getTime()}` })
  }
  catch (error) {
    logger.error('順位計測の投入に失敗しました', { orgId, keywordId, error: String(error) })
    await releaseRankChecks(db, orgId, now, 1)
    await keywordsOf(db, orgId).doc(keywordId).update({ pendingCheckAt: null, lastManualCheckAt: null })
    fail('unavailable', '計測を開始できませんでした。時間をおいて再度お試しください。')
  }
}

export async function createRankKeywordFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: RankDeps = defaultRankDeps,
): Promise<{ id: string; keyword: string; isChecking: boolean }> {
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
  if (isChecking) await enqueueManualCheck(db, deps, orgId, ref.id, now)
  return { id: ref.id, keyword, isChecking }
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
  await enqueueManualCheck(db, deps, orgId, keywordId, now)
}
```

- [ ] **Step 4: その場計測の callable を実装する**

`functions/src/rankings/searches.ts`:

```ts
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
```

- [ ] **Step 5: `index.ts` に export を追加する**

`functions/src/index.ts` の import に追加する（`import { onSchedule } from "firebase-functions/scheduler";` の下）:

```ts
import { onTaskDispatched } from "firebase-functions/tasks";
import { createRankKeywordFunc, deleteRankKeywordFunc, postRankCheckFunc, updateRankKeywordActiveFunc } from "./rankings/keywords";
import { createRankSearchFunc } from "./rankings/searches";
import { runScheduledRankCheck } from "./rankings/scheduled";
import { RANK_MAX_ATTEMPTS, parseRankTask, runRankTask } from "./rankings/worker";
import { defaultRankDeps } from "./rankings/rankDeps";
import type { RankTask } from "./rankings/types";
```

ファイル末尾（`scheduledGbpReviewsSync` の後ろ）に追加する:

```ts
// rankings/ … 順位計測（docs/superpowers/specs/2026-10-08-rank-scraping-design.md 3 章）
export const createRankKeyword = callable((db, caller, data) => createRankKeywordFunc(db, caller, data));
export const updateRankKeywordActive = callable(updateRankKeywordActiveFunc);
export const deleteRankKeyword = callable(deleteRankKeywordFunc);
export const postRankCheck = callable((db, caller, data) => postRankCheckFunc(db, caller, data));
export const createRankSearch = callable((db, caller, data) => createRankSearchFunc(db, caller, data));
// Chromium を載せるため 2GiB。1 インスタンス 1 件ずつ、全体で同時 2 件・5 秒に 1 件まで（Google マップへの負荷とブロックを抑える）
export const rankCheckWorker = onTaskDispatched<RankTask>(
  {
    memory: "2GiB",
    timeoutSeconds: 120,
    concurrency: 1,
    retryConfig: { maxAttempts: RANK_MAX_ATTEMPTS, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 0.2 },
  },
  (request) => runRankTask(getFirestore(), parseRankTask(request.data), defaultRankDeps, {
    isFinalAttempt: request.retryCount >= RANK_MAX_ATTEMPTS - 1,
  }),
);
export const scheduledRankCheck = onSchedule(
  { schedule: "0 4 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540 },
  async () => {
    const summary = await runScheduledRankCheck(getFirestore());
    logger.info("順位の定期計測を投入しました", summary);
  },
);
```

- [ ] **Step 6: テストとビルドが通ることを確認する**

Run: `npm --prefix functions run build && npm --prefix functions test && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: `tsc` がエラーなく終わり、単体テストも結合テストもすべて PASS。

- [ ] **Step 7: 確認**

Run: `git status --short functions/src`
Expected: `keywords.ts`、`searches.ts`、2 つのテスト、`index.ts` の変更が表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 7: スクレイパー本体と実計測スクリプト

**Files:**
- Modify: `functions/package.json`（依存 2 つと `rank:probe` スクリプト）
- Modify（全体を置き換え）: `functions/src/rankings/providers/gmapsScraper.ts`
- Create: `functions/src/rankings/__tests__/probe.ts`
- Test: `functions/src/rankings/__tests__/buildSearchUrl.test.ts`

**Interfaces:**
- Consumes: Task 2 の `RawGmapsItem` / `RankProvider` / `RankProviderError` / `parseGmapsItems` / `RANK_LIMIT`
- Produces:
  - `buildSearchUrl(keyword: string, at: { lat: number; lng: number }): string`
  - `gmapsProvider: RankProvider`

- [ ] **Step 1: 依存の版を決めて追加する**

`@sparticuz/chromium` は、パッケージのメジャー番号が Chromium のメジャー番号と一致します。puppeteer-core は、その Chromium に対応する版を選びます。

Run:
```bash
npm view @sparticuz/chromium version
npm view puppeteer-core versions --json | tail -5
```

続けて、puppeteer の公式の対応表（`https://pptr.dev/supported-browsers`）か、context7 の `/sparticuz/chromium`（"Puppeteer Version to Chromium Compatibility"）で、`@sparticuz/chromium` のメジャー番号と同じ Chrome に対応する `puppeteer-core` の版を確認します。そのうえで、確認した版を固定して入れます。

```bash
npm --prefix functions install --save-exact @sparticuz/chromium@<確認した版> puppeteer-core@<確認した版>
```

Expected: `functions/package.json` の `dependencies` に 2 つが追加される。Chromium は実行時に必要なので、devDependencies ではない。

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/rankings/__tests__/buildSearchUrl.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchUrl } from '../providers/gmapsScraper'

test('buildSearchUrl: キーワードを URL エンコードし、座標・ズーム 14・日本語を指定する', () => {
  assert.equal(
    buildSearchUrl('渋谷 カフェ', { lat: 35.664, lng: 139.698 }),
    'https://www.google.com/maps/search/%E6%B8%8B%E8%B0%B7%20%E3%82%AB%E3%83%95%E3%82%A7/@35.664,139.698,14z?hl=ja&gl=jp',
  )
  assert.ok(buildSearchUrl('a/b?c', { lat: 1, lng: 2 }).startsWith('https://www.google.com/maps/search/a%2Fb%3Fc/@1,2,14z'))
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npm --prefix functions test`
Expected: FAIL（雛形には `buildSearchUrl` がないため、`Module '"../providers/gmapsScraper"' has no exported member 'buildSearchUrl'`）

- [ ] **Step 4: スクレイパーを実装する（雛形を置き換える）**

`functions/src/rankings/providers/gmapsScraper.ts`:

```ts
import chromium from '@sparticuz/chromium'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { RANK_LIMIT, parseGmapsItems } from './parseGmapsItems'
import { RankProviderError, type RankProvider, type RawGmapsItem } from './rankProvider'

// Google マップの検索結果を Headless Chrome で読む（2026-10-08 に画面構造を確認。仕様書 4.1）。
// 画面構造が変わったら、まず `npm --prefix functions run rank:probe` で実画面を確認する

const SEARCH_ZOOM = 14
const NAVIGATION_TIMEOUT_MS = 30_000
const RESULT_TIMEOUT_MS = 15_000
const SCROLL_WAIT_MS = 1_200
/** 件数が増えないスクロールがこの回数続いたら止める */
const MAX_IDLE_SCROLLS = 5
/** 広告を除いても 20 件残るよう、少し多めに読む */
const COLLECT_TARGET = RANK_LIMIT + 5

export function buildSearchUrl(keyword: string, at: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${at.lat},${at.lng},${SEARCH_ZOOM}z?hl=ja&gl=jp`
}

let browserPromise: Promise<Browser> | null = null

/** インスタンス内で Chromium を使い回す。CHROME_PATH があれば手元の Chrome を使う（rank:probe 用） */
function getBrowser(): Promise<Browser> {
  browserPromise ??= (async () => {
    const localChrome = process.env.CHROME_PATH
    const browser = await puppeteer.launch({
      executablePath: localChrome ?? await chromium.executablePath(),
      args: localChrome ? [] : chromium.args,
      headless: localChrome ? true : 'shell',
      defaultViewport: { width: 1280, height: 900 },
    })
    browser.on('disconnected', () => { browserPromise = null })
    return browser
  })().catch((error: unknown) => {
    browserPromise = null
    throw error
  })
  return browserPromise
}

function assertNotBlocked(url: string): void {
  if (url.includes('/sorry/') || url.includes('consent.google.com')) throw new RankProviderError('blocked', `ブロックされました: ${url}`)
}

/** 一覧（feed）・店舗ページへの直接移動（1 件だけ）・結果なし のどれになったか */
async function waitForResultState(page: Page): Promise<'feed' | 'place' | 'none'> {
  const handle = await page.waitForFunction(() => {
    if (document.querySelector('div[role="feed"]')) return 'feed'
    if (location.pathname.includes('/maps/place/') && document.querySelector('h1')) return 'place'
    if (/見つかりませんでした/.test(document.body?.innerText ?? '')) return 'none'
    return false
  }, { timeout: RESULT_TIMEOUT_MS, polling: 500 })
  assertNotBlocked(page.url())
  return await handle.jsonValue() as 'feed' | 'place' | 'none'
}

/** ブラウザ内で実行する。外側の変数は使えない */
function collectFeedItems(): RawGmapsItem[] {
  const feed = document.querySelector('div[role="feed"]')
  if (!feed) return []
  return [...feed.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]')].map((anchor) => {
    const card = (anchor.closest('div[jsaction]')?.parentElement ?? anchor.parentElement) as HTMLElement | null
    const text = card?.innerText ?? ''
    return {
      name: anchor.getAttribute('aria-label') ?? '',
      href: anchor.href,
      starLabel: card?.querySelector('span[role="img"][aria-label]')?.getAttribute('aria-label') ?? null,
      text,
      isSponsored: /スポンサー/.test(text),
    }
  })
}

async function scrollAndCollect(page: Page): Promise<RawGmapsItem[]> {
  let idle = 0
  let lastCount = 0
  while (idle < MAX_IDLE_SCROLLS) {
    const { count, isEnd } = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]')
      if (!feed) return { count: 0, isEnd: true }
      feed.scrollBy(0, feed.scrollHeight)
      return {
        count: feed.querySelectorAll('a[href*="/maps/place/"]').length,
        isEnd: (feed as HTMLElement).innerText.includes('リストの最後に到達しました'),
      }
    })
    if (count >= COLLECT_TARGET || isEnd) break
    idle = count > lastCount ? 0 : idle + 1
    lastCount = count
    await new Promise(resolve => setTimeout(resolve, SCROLL_WAIT_MS))
  }
  return page.evaluate(collectFeedItems)
}

/** 結果が 1 件だけで店舗ページに直接移動したとき */
async function readPlacePage(page: Page): Promise<RawGmapsItem> {
  return page.evaluate(() => ({
    name: document.querySelector('h1')?.textContent?.trim() ?? '',
    href: location.href,
    starLabel: document.querySelector('div[role="main"] span[role="img"][aria-label*="つ星"]')?.getAttribute('aria-label') ?? null,
    text: '',
    isSponsored: false,
  }))
}

export const gmapsProvider: RankProvider = {
  async search(keyword, at) {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' })
      await page.goto(buildSearchUrl(keyword, at), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
      assertNotBlocked(page.url())
      const state = await waitForResultState(page)
      if (state === 'none') return []
      if (state === 'place') return parseGmapsItems([await readPlacePage(page)])
      return parseGmapsItems(await scrollAndCollect(page))
    }
    catch (error) {
      if (error instanceof RankProviderError) throw error
      assertNotBlocked(page.url())
      if (error instanceof Error && error.name === 'TimeoutError') throw new RankProviderError('timeout', error.message)
      throw new RankProviderError('parse', String(error))
    }
    finally {
      await page.close().catch(() => undefined)
    }
  },
}
```

- [ ] **Step 5: 実計測スクリプトを作る**

`functions/src/rankings/__tests__/probe.ts`（`__tests__` 配下なので `lib/` に入らず、デプロイされない）:

```ts
import { gmapsProvider } from '../providers/gmapsScraper'

// 手元から Google マップを実際に計測する。画面構造が変わったときの確認用。
// 使い方: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm --prefix functions run rank:probe -- "渋谷 カフェ" 35.664 139.698

async function main(): Promise<void> {
  const [keyword, lat, lng] = process.argv.slice(2)
  if (!keyword || !lat || !lng) {
    console.error('使い方: npm --prefix functions run rank:probe -- "<キーワード>" <緯度> <経度>')
    process.exit(1)
  }
  const startedAt = Date.now()
  const results = await gmapsProvider.search(keyword, { lat: Number(lat), lng: Number(lng) })
  console.table(results)
  console.log(`${results.length} 件 / ${Date.now() - startedAt} ms`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
```

`functions/package.json` の `scripts` に追加する:

```json
    "rank:probe": "tsc -p tsconfig.test.json && node lib-test/rankings/__tests__/probe.js",
```

- [ ] **Step 6: テストとビルドが通ることを確認する**

Run: `npm --prefix functions run build && npm --prefix functions test`
Expected: PASS。`lib/rankings/providers/gmapsScraper.js` が出力され、`lib/rankings/__tests__/` は出力されない。

- [ ] **Step 7: 実画面で計測する**

Run: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm --prefix functions run rank:probe -- "渋谷 カフェ" 35.664 139.698`
Expected: 20 行の表が出る。1 位付近に「DUKE Cafe 渋谷神南店」「Nakaniwa URBAN COFFEE COURTYARD」などがあり、`placeId` は `ChIJ` で始まる。`rating` と `reviewCount` は数値、`category` は「カフェ・喫茶」など。処理時間は 5〜15 秒程度。

あわせて次の 2 つも実行し、結果を確認する。
- `npm --prefix functions run rank:probe -- "存在しない語句xyzqwe" 35.664 139.698` → `0 件`
- `"渋谷区役所" 35.664 139.698` → 1 件（店舗ページへの直接移動）

`0 件` にならず `RankProviderError: parse` が出る場合は、`waitForResultState` の「結果なし」判定の文言（`/見つかりませんでした/`）を、実画面に出る文言に合わせて直す。

- [ ] **Step 8: 確認**

Run: `git status --short functions`
Expected: `package.json`、`package-lock.json`、`gmapsScraper.ts`、`probe.ts`、`buildSearchUrl.test.ts` が表示される。コミットはユーザーの許可がある場合のみ行う。

---

### Task 8: 画面側の型・キーワードの検証・モック

**Files:**
- Modify: `app/types/domain.ts`（`SearchLocation` 〜 `RankSnapshot` の区間 :231-265）
- Create: `app/utils/rankKeyword.ts`
- Modify（全体を置き換え）: `app/utils/mock/rank.ts`
- Modify（全体を置き換え）: `app/utils/mock/functions/rankings.ts`
- Modify: `app/utils/mock/seed.ts`（`MockDb`、:352-371 のキーワードとスナップショット、:400-401 の返り値）
- Modify: `app/utils/firebase/emptyDb.ts`

**Interfaces:**
- Produces（`~/types/domain`）:
  - `RankStatus = 'ok' | 'error'`
  - `RankErrorCode = 'blocked' | 'timeout' | 'parse'`
  - `RankMatchedBy = 'placeId' | 'name' | null`
  - `interface RankResult { rank; placeId: string | null; name; rating: number | null; reviewCount: number | null; category: string | null }`
  - `RankKeyword` に `pendingCheckAt: string | null` を追加
  - `interface RankSnapshot { keywordId; storeId; checkedOn; checkedAt; trigger; status; errorCode: RankErrorCode | null; rank: number | null; matchedBy; resultCount }`
  - `interface RankResultsDoc { keywordId; checkedOn; results: RankResult[] }`
  - `RankSearchStatus = 'queued' | 'running' | 'done' | 'error'`
  - `interface RankSearch { id; orgId; keyword; searchLocation; storeId: string | null; status; errorCode; rank; matchedBy; results; createdBy; createdAt; finishedAt: string | null }`
  - 削除：`RankCompetitor`
- Produces（`~/utils/rankKeyword`）:
  - `KEYWORD_MIN_LENGTH = 2` / `KEYWORD_MAX_LENGTH = 100`
  - `normalizeKeyword(value: string): string`
  - `keywordErrorOf(value: string): string | null`
  - `RANK_DISCLAIMER: string`
  - `RANK_PENDING_TIMEOUT_MS = 600000`
  - `isPendingCheck(pendingCheckAt: string | null, now?: number): boolean`
  - `rankErrorText(code: RankErrorCode | null): string`
- Produces（`MockDb`）: `rankResults: RankResultsDoc[]`、`rankSearches: RankSearch[]`
- Produces（モック）:
  - `createRankKeywordFunc(db, uid, input) => { id; keyword; isChecking }`
  - `updateRankKeywordActiveFunc`
  - `deleteRankKeywordFunc`
  - `postRankCheckFunc`
  - `createRankSearchFunc(db, uid, input: { orgId; keyword; searchLocation; storeId: string | null }) => RankSearch`
  - `completeMockRankSearch(db, searchId): void`
  - `RANK_CHECK_RANGE = 20`

- [ ] **Step 1: 型を差し替える**

`app/types/domain.ts` の `export interface RankKeyword {` から `RankSnapshot` の閉じ括弧（`trigger: 'scheduled' | 'manual'\n}`）までを、次の内容に置き換える（`SearchLocation` はそのまま残す）:

```ts
export interface RankKeyword {
  id: string
  orgId: string
  storeId: string
  keyword: string
  searchLocation: SearchLocation
  isActive: boolean
  createdAt: string
  /** 手動計測の受け付けから完了まで値が入る（「計測中」の表示） */
  pendingCheckAt: string | null
}

export type RankStatus = 'ok' | 'error'
export type RankErrorCode = 'blocked' | 'timeout' | 'parse'
export type RankMatchedBy = 'placeId' | 'name' | null

/** 検索結果の 1 件（1〜20 位）。競合一覧にそのまま使う */
export interface RankResult {
  rank: number
  placeId: string | null
  name: string
  rating: number | null
  reviewCount: number | null
  category: string | null
}

/** organizations/{orgId}/rankSnapshots/{keywordId}_{YYYY-MM-DD}。直近 90 日を購読する */
export interface RankSnapshot {
  keywordId: string
  storeId: string
  /** YYYY-MM-DD（JST）。同日の再計測は上書き */
  checkedOn: string
  checkedAt: string
  trigger: 'scheduled' | 'manual'
  /** error は取得エラー（圏外とは別） */
  status: RankStatus
  errorCode: RankErrorCode | null
  /** null は圏外（21 位以下・一致なし）。error のときも null */
  rank: number | null
  matchedBy: RankMatchedBy
  resultCount: number
}

/** organizations/{orgId}/rankResults/{keywordId}_{YYYY-MM-DD}。日付を選んだときに読む */
export interface RankResultsDoc {
  keywordId: string
  checkedOn: string
  results: RankResult[]
}

export type RankSearchStatus = 'queued' | 'running' | 'done' | 'error'

/** organizations/{orgId}/rankSearches/{searchId}。その場計測（30 日で自動削除） */
export interface RankSearch {
  id: string
  orgId: string
  keyword: string
  searchLocation: SearchLocation
  storeId: string | null
  status: RankSearchStatus
  errorCode: RankErrorCode | null
  rank: number | null
  matchedBy: RankMatchedBy
  results: RankResult[]
  createdBy: string
  createdAt: string
  finishedAt: string | null
}
```

- [ ] **Step 2: キーワードの検証と表示用の定数を作る**

`app/utils/rankKeyword.ts`:

```ts
import type { RankErrorCode } from '~/types/domain'

// 順位計測の入力検証と表示文言（functions/src/rankings/validation.ts と同じ規則）

export const KEYWORD_MIN_LENGTH = 2
export const KEYWORD_MAX_LENGTH = 100
/** 手動計測の「計測中」をこの時間で打ち切る（ワーカーが落ちたときに表示が残り続けないように） */
export const RANK_PENDING_TIMEOUT_MS = 10 * 60 * 1000

export const RANK_DISCLAIMER = '検索順位は検索した人の位置や端末によって変わるため、目安としてご覧ください。'

/** 全角スペースを含む空白を半角 1 つにまとめ、前後を除く */
export function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function keywordErrorOf(value: string): string | null {
  const length = normalizeKeyword(value).length
  return length < KEYWORD_MIN_LENGTH || length > KEYWORD_MAX_LENGTH
    ? `キーワードは ${KEYWORD_MIN_LENGTH}〜${KEYWORD_MAX_LENGTH} 文字で入力してください`
    : null
}

export function isPendingCheck(pendingCheckAt: string | null, now = Date.now()): boolean {
  return pendingCheckAt !== null && now - Date.parse(pendingCheckAt) < RANK_PENDING_TIMEOUT_MS
}

export function rankErrorText(code: RankErrorCode | null): string {
  if (code === 'blocked') return '取得エラー（Google マップへのアクセスが制限されました）'
  if (code === 'timeout') return '取得エラー（時間内に結果を取得できませんでした）'
  return '取得エラー'
}
```

- [ ] **Step 3: モックの計測結果を置き換える**

`app/utils/mock/rank.ts`:

```ts
import type { RankKeyword, RankResult, RankResultsDoc, RankSnapshot, Store } from '~/types/domain'
import { createRandom, randomInt } from './random'

// F-16 順位計測のモック。Google マップの代わりに、キーワードごとに決まった傾向の順位と上位 20 件を返す。

export const RANK_CHECK_RANGE = 20

const COMPETITOR_SUFFIXES = ['食堂', 'キッチン', 'ダイニング', '亭', 'カフェ', 'ビストロ', '屋', '茶房', 'ごはん処', 'バル', '商店', 'テラス']
const COMPETITOR_PREFIXES = ['あさひ', 'みどり', '和楽', 'はなまる', 'つばき', 'こはく', 'ひなた', 'なごみ', 'かえで', 'すずらん', 'まるや', 'いろは']
const CATEGORIES = ['定食屋', 'カフェ・喫茶', '和食店', 'レストラン', '居酒屋', 'コーヒーショップ・喫茶店']

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mockCompetitor(seed: string, rank: number): RankResult {
  const random = createRandom(hashString(`${seed}-${rank}`))
  const prefix = COMPETITOR_PREFIXES[randomInt(random, 0, COMPETITOR_PREFIXES.length - 1)]
  const suffix = COMPETITOR_SUFFIXES[randomInt(random, 0, COMPETITOR_SUFFIXES.length - 1)]
  return {
    rank,
    placeId: `mock-place-${hashString(`${seed}-${rank}`)}`,
    name: `${prefix}${suffix}`,
    rating: Math.round((3.6 + random() * 1.3) * 10) / 10,
    reviewCount: randomInt(random, 20, 900),
    category: CATEGORIES[randomInt(random, 0, CATEGORIES.length - 1)]!,
  }
}

/** 上位 20 件。rank の位置に自店を置く */
export function mockResultsFor(seed: string, store: Store | null, rank: number | null): RankResult[] {
  return Array.from({ length: RANK_CHECK_RANGE }, (_, index) => {
    const position = index + 1
    if (store && position === rank) {
      return { rank: position, placeId: store.placeId || null, name: store.name, rating: 4.3, reviewCount: 180, category: CATEGORIES[0]! }
    }
    return mockCompetitor(seed, position)
  })
}

/**
 * seed から決まる基準順位を中心に、日付ごとに揺らした順位を返す。
 * 基準が計測範囲の外側に近いものは、ときどき圏外（null）になる。
 */
export function mockRankFor(seed: string, day: string): number | null {
  const base = (hashString(seed) % 14) + 2
  // 日単位のゆるやかな波 + 小さな揺らぎで、推移グラフが自然に見えるようにする
  const dayIndex = Math.floor(Date.parse(day) / 86_400_000)
  const wave = Math.round(Math.sin((dayIndex + (hashString(seed) % 30)) / 5) * 3)
  const noise = (hashString(`${seed}${day}`) % 3) - 1
  const rank = base + wave + noise
  if (rank > RANK_CHECK_RANGE - 5 && hashString(`${seed}${day}`) % 3 === 0) return null
  return Math.min(Math.max(rank, 1), RANK_CHECK_RANGE)
}

/** 定期計測で取得エラーになる日（約 1/30）。推移グラフでエラーの日の表示を確認するため */
export function isMockErrorDay(seed: string, day: string): boolean {
  return hashString(`${seed}:error:${day}`) % 30 === 0
}

export function createMockCheck(
  keyword: RankKeyword,
  store: Store,
  day: string,
  checkedAt: string,
  trigger: RankSnapshot['trigger'],
): { snapshot: RankSnapshot; results: RankResultsDoc | null } {
  const base = { keywordId: keyword.id, storeId: keyword.storeId, checkedOn: day, checkedAt, trigger }
  if (trigger === 'scheduled' && isMockErrorDay(keyword.id, day)) {
    return { snapshot: { ...base, status: 'error', errorCode: 'blocked', rank: null, matchedBy: null, resultCount: 0 }, results: null }
  }
  const rank = mockRankFor(keyword.id, day)
  const results = mockResultsFor(keyword.id, store, rank)
  return {
    snapshot: { ...base, status: 'ok', errorCode: null, rank, matchedBy: rank === null ? null : 'placeId', resultCount: results.length },
    results: { keywordId: keyword.id, checkedOn: day, results },
  }
}
```

- [ ] **Step 4: モックの Functions を置き換える**

`app/utils/mock/functions/rankings.ts`:

```ts
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
): { id: string; keyword: string; isChecking: boolean } {
  const org = requireOrg(db, input.orgId)
  requireMember(db, input.orgId, uid, ['owner', 'admin'])
  const keywordText = requireKeywordText(input.keyword)
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
  return { id: keyword.id, keyword: keyword.keyword, isChecking }
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
```

- [ ] **Step 5: 初期データと空の DB をそろえる**

`app/utils/mock/seed.ts`:

1. import の `RankSnapshot,` の下に `RankResultsDoc,` と `RankSearch,` を追加する（アルファベット順の並びに合わせる）。`import { createMockSnapshot } from './rank'` は `import { createMockCheck } from './rank'` に変える。
2. `MockDb` の `rankSnapshots: RankSnapshot[]` の下に追加する:

```ts
  rankResults: RankResultsDoc[]
  rankSearches: RankSearch[]
```

3. `rankKeywords` の生成（:352-363）で、`searchLocation` と `createdAt` を次のように変える（市区町村名を地点名にする）:

```ts
      searchLocation: { lat: store.lat, lng: store.lng, label: nearestMunicipality(store.lat, store.lng)?.label ?? `${store.name} 周辺` },
      isActive,
      createdAt: iso(60),
      pendingCheckAt: null,
```

ファイル先頭の import に `import { nearestMunicipality } from '../geo/municipality'` を追加する（このモジュールは Task 9 で作る。Task 8 の型チェックは Task 9 の後に行う）。

4. `rankSnapshots` の生成（:365-372）を、次の内容に置き換える:

```ts
  const rankChecks = rankKeywords.flatMap((keyword) => {
    const store = stores.find(item => item.id === keyword.storeId)!
    // 停止中のキーワードは停止前（15 日前まで）の履歴だけ持つ
    const firstDay = keyword.isActive ? 0 : 15
    return Array.from({ length: 90 - firstDay }, (_, offset) => {
      const date = daysAgo(now, firstDay + offset, 6)
      return createMockCheck(keyword, store, toDayKey(date), date.toISOString(), 'scheduled')
    })
  })
  const rankSnapshots: RankSnapshot[] = rankChecks.map(check => check.snapshot)
  const rankResults: RankResultsDoc[] = rankChecks.flatMap(check => (check.results ? [check.results] : []))
```

5. 返り値（:400-401 の `rankKeywords,` `rankSnapshots,`）の後ろに `rankResults,` と `rankSearches: [],` を追加する。

`app/utils/firebase/emptyDb.ts` の `rankSnapshots: [],` の下に追加する:

```ts
    rankResults: [],
    rankSearches: [],
```

- [ ] **Step 6: 確認（型チェックは Task 9 の後）**

Run: `grep -rn "RankCompetitor\|topPlaceIds\|getMockPlaceDetails\|createMockSnapshot" app`
Expected: `app/composables/useRankHistory.ts` と `app/pages/admin/[orgId]/rankings/[keywordId].vue` にだけ残る（Task 10・11 で直す）。

---

### Task 9: 市区町村データと地域の選択欄

**Files:**
- Create: `scripts/build-municipalities.mjs`
- Create: `app/utils/geo/municipalities.json`（スクリプトで生成）
- Create: `app/utils/geo/municipality.ts`
- Create: `app/components/Ranking/Input/AreaSelect.vue`

**Interfaces:**
- Produces:
  - `interface Municipality { code: string; label: string; lat: number; lng: number }`
  - `MUNICIPALITIES: Municipality[]`
  - `searchMunicipalities(query: string, max?: number): Municipality[]`
  - `nearestMunicipality(lat: number, lng: number): Municipality | null`
  - `findMunicipalityByLabel(label: string): Municipality | null`
  - コンポーネント `<RankingInputAreaSelect v-model="Municipality | null" :error :label :hint />`

- [ ] **Step 1: データ元を取得する**

1. 国土数値情報「市区町村役場データ」（P34）のページ `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P34.html` を開き、利用規約（商用利用の可否と出典の書き方）を確認する。**商用利用ができない場合は、ここで止めてユーザーに確認する。**
2. 全国版をダウンロードする。スクラッチ領域の空のディレクトリに置き、ZIP をそこで展開する。
3. GeoJSON が含まれていない場合は、Shapefile を変換する:

```bash
npx --yes mapshaper -i P34-14.shp encoding=shiftjis -o format=geojson p34.json
```

4. 属性名を確認する:

```bash
node -e "const f=require('./p34.json').features; console.log(f.length, JSON.stringify(f[0].properties), f[0].geometry)"
```

Expected: `P34_001`（行政区域コード）・`P34_002`（施設分類）・`P34_003`（名称）・`P34_004`（所在地）が並び、geometry は `Point [経度, 緯度]` になっている。違う場合は、Step 2 のスクリプトの `CODE` / `KIND` / `NAME` を実物に合わせる。施設分類のうち「本庁（市役所・区役所・町村役場）」にあたる値も、このときに確かめる。

- [ ] **Step 2: 変換スクリプトを書く**

`scripts/build-municipalities.mjs`:

```js
// 国土数値情報「市区町村役場データ」（P34）の GeoJSON から、市区町村の選択欄用の JSON を作る。
// 使い方: node scripts/build-municipalities.mjs <p34.json> > app/utils/geo/municipalities.json
import { readFileSync } from 'node:fs'

const CODE = 'P34_001'
const KIND = 'P34_002'
const NAME = 'P34_003'
/** 本庁（市役所・区役所・町村役場）の施設分類 */
const HEAD_OFFICE_KINDS = new Set(['1', 1])

const PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']

const [, , input] = process.argv
if (!input) {
  console.error('使い方: node scripts/build-municipalities.mjs <p34.json>')
  process.exit(1)
}

const round = value => Math.round(value * 10000) / 10000
const byCode = new Map()
for (const feature of JSON.parse(readFileSync(input, 'utf8')).features) {
  const props = feature.properties
  if (!HEAD_OFFICE_KINDS.has(props[KIND])) continue
  const code = String(props[CODE]).padStart(5, '0')
  const prefecture = PREFECTURES[Number(code.slice(0, 2)) - 1]
  const name = String(props[NAME]).replace(/(役所|役場)$/, '')
  if (!prefecture || byCode.has(code)) continue
  const [lng, lat] = feature.geometry.coordinates
  byCode.set(code, { code, label: `${prefecture}${name}`, lat: round(lat), lng: round(lng) })
}

const municipalities = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
process.stdout.write(`${JSON.stringify(municipalities)}\n`)
console.error(`${municipalities.length} 件`)
```

- [ ] **Step 3: JSON を生成して中身を確かめる**

Run:
```bash
node scripts/build-municipalities.mjs <展開先>/p34.json > app/utils/geo/municipalities.json
node -e "const m=require('./app/utils/geo/municipalities.json'); for (const l of ['東京都渋谷区','北海道札幌市中央区','大阪府大阪市北区','沖縄県那覇市']) console.log(l, JSON.stringify(m.find(x=>x.label===l)))"
```

Expected:
- 件数は 1,700〜1,950 件程度。
- 4 件ともに見つかる。
- `東京都渋谷区` の座標がおよそ `lat 35.66 / lng 139.70` になる。

見つからない市区町村があれば、名称の末尾の処理（`役所|役場`）か施設分類を実物に合わせて直し、もう一度生成する。

- [ ] **Step 4: 検索と最寄りの計算を作る**

`app/utils/geo/municipality.ts`:

```ts
import data from './municipalities.json'

// 順位計測の検索地点。国土数値情報「市区町村役場データ」（P34）から作った市区町村の代表地点（役場の位置）。
// 生成: node scripts/build-municipalities.mjs <p34.json> > app/utils/geo/municipalities.json

export interface Municipality {
  /** 全国地方公共団体コード（5 桁） */
  code: string
  /** 例: 東京都渋谷区 */
  label: string
  lat: number
  lng: number
}

export const MUNICIPALITIES: Municipality[] = data as Municipality[]

/** 名前の一部で探す（空白は無視）。都道府県名から入力しても、市区町村名だけでも当たる */
export function searchMunicipalities(query: string, max = 20): Municipality[] {
  const text = query.replace(/\s+/g, '')
  if (text === '') return []
  return MUNICIPALITIES.filter(item => item.label.includes(text)).slice(0, max)
}

export function findMunicipalityByLabel(label: string): Municipality | null {
  return MUNICIPALITIES.find(item => item.label === label) ?? null
}

/** 店舗の座標から最も近い市区町村（座標が未設定の 0,0 なら null） */
export function nearestMunicipality(lat: number, lng: number): Municipality | null {
  if (lat === 0 && lng === 0) return null
  // 国内の近さを比べるだけなので、経度を緯度で補正した平面距離で十分
  const scale = Math.cos((lat * Math.PI) / 180)
  let nearest: Municipality | null = null
  let best = Number.POSITIVE_INFINITY
  for (const item of MUNICIPALITIES) {
    const distance = (item.lat - lat) ** 2 + ((item.lng - lng) * scale) ** 2
    if (distance < best) {
      best = distance
      nearest = item
    }
  }
  return nearest
}
```

- [ ] **Step 5: 地域の選択欄を作る**

`app/components/Ranking/Input/AreaSelect.vue`:

```vue
<script setup lang="ts">
import { searchMunicipalities, type Municipality } from '~/utils/geo/municipality'

// 順位計測の検索地点（市区町村）。文字を入力して候補から選ぶ

interface Props {
  label?: string
  hint?: string
  error?: string | null
}

withDefaults(defineProps<Props>(), {
  label: '地域',
  hint: '市区町村名の一部を入力して選びます（例: 渋谷）',
  error: null,
})

const model = defineModel<Municipality | null>({ required: true })
const id = useId()
const listId = `${id}-list`
const query = ref(model.value?.label ?? '')
const isOpen = ref(false)
const activeIndex = ref(0)
const options = computed(() => searchMunicipalities(query.value))

watch(model, (value) => { query.value = value?.label ?? '' })

function onInput(): void {
  isOpen.value = true
  activeIndex.value = 0
  // 選択後に文字を変えたら、選択を外す（入力途中の文字列を地点として扱わない）
  if (model.value && query.value !== model.value.label) model.value = null
}

function onSelect(option: Municipality): void {
  model.value = option
  query.value = option.label
  isOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isOpen.value = false
    return
  }
  if (!isOpen.value || options.value.length === 0) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + delta + options.value.length) % options.value.length
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const option = options.value[activeIndex.value]
    if (option) onSelect(option)
  }
}
</script>

<template>
  <div class="relative space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-slate-700">
      {{ label }}
      <span class="ml-1 text-xs text-rose-600">必須</span>
    </label>
    <input
      :id="id"
      v-model="query"
      type="text"
      role="combobox"
      autocomplete="off"
      placeholder="例: 東京都渋谷区"
      :aria-expanded="isOpen && options.length > 0"
      :aria-controls="listId"
      :aria-activedescendant="isOpen && options[activeIndex] ? `${listId}-${options[activeIndex]!.code}` : undefined"
      :aria-invalid="error ? 'true' : undefined"
      class="block h-10 w-full rounded-lg border bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
      :class="error ? 'border-rose-400' : 'border-slate-300'"
      @input="onInput"
      @focus="isOpen = query !== '' && !model"
      @blur="isOpen = false"
      @keydown="onKeydown"
    >
    <ul
      v-if="isOpen && options.length > 0"
      :id="listId"
      role="listbox"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
    >
      <li
        v-for="(option, index) in options"
        :id="`${listId}-${option.code}`"
        :key="option.code"
        role="option"
        :aria-selected="index === activeIndex"
        class="cursor-pointer px-3 py-2"
        :class="index === activeIndex ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'"
        @mousedown.prevent="onSelect(option)"
        @mouseenter="activeIndex = index"
      >
        {{ option.label }}
      </li>
    </ul>
    <p v-if="isOpen && query !== '' && options.length === 0" class="text-xs text-slate-500">該当する市区町村がありません</p>
    <p v-if="error" class="text-xs text-rose-700">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
```

`@mousedown.prevent` で入力欄のフォーカスを外さずに選ぶため、`@blur` ですぐ閉じても選択は失われない。

- [ ] **Step 6: 型チェック（Task 8 の分も含む）**

Run: `npm run typecheck`
Expected: エラーは `app/composables/useRankHistory.ts`、`app/composables/useRankKeywords.ts`、`app/pages/admin/[orgId]/rankings/*.vue`、`KeywordFormModal.vue` だけ（Task 10・11 で直す）。`seed.ts`、`rank.ts`、`rankings.ts`、`municipality.ts`、`AreaSelect.vue` にはエラーが出ない。

---

### Task 10: 本物モードの購読と composable

**Files:**
- Modify: `app/utils/firebase/converters.ts`（末尾に追加）
- Modify: `app/composables/useFirestoreSync.ts`
- Modify（全体を置き換え）: `app/composables/useRankKeywords.ts`
- Modify（全体を置き換え）: `app/composables/useRankHistory.ts`
- Create: `app/composables/useRankSearch.ts`

**Interfaces:**
- Consumes：Task 8 の型・モック・`isPendingCheck`、`RANK_CHECK_RANGE`
- Produces:
  - `toRankKeyword(id, orgId, data): RankKeyword`
  - `toRankSnapshot(data): RankSnapshot`
  - `toRankResults(data): RankResultsDoc`
  - `toRankSearch(id, orgId, data): RankSearch`
  - `useRankKeywords()`
    - 返り値：`{ rows, createKeyword, setActive, deleteKeyword, checkNow }`
    - `KeywordRow` に `isChecking: boolean` を追加
    - `createKeyword` は `Promise<{ id; keyword; isChecking }>` を返す
    - `checkNow` は `Promise<'done' | 'started'>` を返す
  - `useRankHistory(keywordId)`
    - 返り値：`{ keyword, storeName, period, history, periodHistory, latest, bestRank, selectedDay, selectedSnapshot, results, isLoadingResults, resultsError }`
    - `RANK_PERIODS` / `RankPeriod` / `RANK_RANGE` の export は維持する
  - `useRankSearch()`
    - 返り値：`{ searches, current, startSearch, select }`
    - `startSearch(input: { keyword: string; searchLocation: SearchLocation; storeId: string | null }): Promise<void>`

- [ ] **Step 1: 変換を追加する**

`app/utils/firebase/converters.ts` の import の型に `RankKeyword, RankResultsDoc, RankSearch, RankSnapshot` を加え、末尾に追加する:

```ts
export function toRankKeyword(id: string, orgId: string, data: DocumentData): RankKeyword {
  return {
    id,
    orgId,
    storeId: data.storeId,
    keyword: data.keyword,
    searchLocation: data.searchLocation,
    isActive: data.isActive === true,
    createdAt: toIso(data.createdAt),
    pendingCheckAt: data.pendingCheckAt ? toIso(data.pendingCheckAt) : null,
  }
}

export function toRankSnapshot(data: DocumentData): RankSnapshot {
  return {
    keywordId: data.keywordId,
    storeId: data.storeId,
    checkedOn: data.checkedOn,
    checkedAt: toIso(data.checkedAt),
    trigger: data.trigger,
    status: data.status ?? 'ok',
    errorCode: data.errorCode ?? null,
    rank: data.rank ?? null,
    matchedBy: data.matchedBy ?? null,
    resultCount: data.resultCount ?? 0,
  }
}

export function toRankResults(data: DocumentData): RankResultsDoc {
  return { keywordId: data.keywordId, checkedOn: data.checkedOn, results: data.results ?? [] }
}

export function toRankSearch(id: string, orgId: string, data: DocumentData): RankSearch {
  return {
    id,
    orgId,
    keyword: data.keyword,
    searchLocation: data.searchLocation,
    storeId: data.storeId ?? null,
    status: data.status,
    errorCode: data.errorCode ?? null,
    rank: data.rank ?? null,
    matchedBy: data.matchedBy ?? null,
    results: data.results ?? [],
    createdBy: data.createdBy,
    createdAt: toIso(data.createdAt),
    finishedAt: data.finishedAt ? toIso(data.finishedAt) : null,
  }
}
```

- [ ] **Step 2: 購読を追加する**

`app/composables/useFirestoreSync.ts`:

1. 型の import に `RankKeyword, RankSearch, RankSnapshot` を、converters の import に `toRankKeyword, toRankSearch, toRankSnapshot` を加える。`import { toDayKey } from '~/utils/format'` を追加する。
2. `const templates = new MirrorCollection...` の下に追加する:

```ts
  const rankKeywords = new MirrorCollection<RankKeyword>(item => item.id, (items) => { db.value.rankKeywords = items })
  const rankSnapshots = new MirrorCollection<RankSnapshot>(item => `${item.keywordId}_${item.checkedOn}`, (items) => { db.value.rankSnapshots = items })
  const rankSearches = new MirrorCollection<RankSearch>(item => item.id, (items) => { db.value.rankSearches = items })
```

3. `resetAll` の配列 `[organizations, members, stores, invitations, connections, profiles, reviews, posts, templates]` に `rankKeywords, rankSnapshots, rankSearches` を加える。`watchCurrentOrg` の `[stores, invitations, connections, profiles, reviews, posts, templates]` にも同じ 3 つを加える。
4. `const POST_LIMIT = 200` の下に追加する:

```ts
  /** 順位の推移は最大 90 日表示する */
  const RANK_HISTORY_DAYS = 90
  /** その場計測の履歴（新しい順） */
  const RANK_SEARCH_LIMIT = 30
```

5. `watchCurrentOrg` の `watchStoreScoped(orgId, member, 'gbpPosts', ...)` の下に追加する:

```ts
    watchStoreScoped(orgId, member, 'rankKeywords', rankKeywords, (id, data) => toRankKeyword(id, orgId, data))
    const rankFrom = toDayKey(new Date(Date.now() - RANK_HISTORY_DAYS * 86_400_000))
    watchStoreScoped(orgId, member, 'rankSnapshots', rankSnapshots, (_, data) => toRankSnapshot(data), [where('checkedOn', '>=', rankFrom)])
```

6. `if (member.role === 'staff') return` の下（invitations の購読の前）に追加する:

```ts
    currentOrgSubscriptions.push(onSnapshot(
      query(collection($db, `organizations/${orgId}/rankSearches`), orderBy('createdAt', 'desc'), limit(RANK_SEARCH_LIMIT)),
      (snapshot) => { rankSearches.set('current', snapshot.docs.map(item => toRankSearch(item.id, orgId, item.data()))) },
    ))
```

- [ ] **Step 3: `useRankKeywords` を置き換える**

`app/composables/useRankKeywords.ts`:

```ts
import type { RankKeyword, RankSnapshot, SearchLocation } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import {
  createRankKeywordFunc,
  deleteRankKeywordFunc,
  postRankCheckFunc,
  updateRankKeywordActiveFunc,
} from '~/utils/mock/functions/rankings'
import { mockLatency } from '~/utils/mock/functions/shared'
import { isPendingCheck } from '~/utils/rankKeyword'

// F-15 順位キーワード管理 / F-17 一覧表示用の最新順位

export interface KeywordRow {
  keyword: RankKeyword
  storeName: string
  latest: RankSnapshot | null
  /** 前日比・前週比。正の値は順位が上がった（数字が小さくなった） */
  dayDiff: number | null
  weekDiff: number | null
  /** 直近 30 日（古い順）。圏外・取得エラーは null */
  recentRanks: (number | null)[]
  /** 直近 30 日の日付つき順位（古い順）。推移グラフ用 */
  recentPoints: { day: string; rank: number | null; isError: boolean }[]
  /** 手動計測の結果待ち */
  isChecking: boolean
}

function diff(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null) return null
  return previous - current
}

export function useRankKeywords() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, canAccessStore, storeName } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const rows = computed<KeywordRow[]>(() =>
    db.value.rankKeywords
      .filter(keyword => keyword.orgId === orgId.value && canAccessStore(keyword.storeId))
      .map((keyword) => {
        const history = db.value.rankSnapshots
          .filter(snapshot => snapshot.keywordId === keyword.id)
          .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn))
        const latest = history[0] ?? null
        const recent = history.slice(0, 30).reverse()
        return {
          keyword,
          storeName: storeName(keyword.storeId),
          latest,
          dayDiff: diff(latest?.rank, history[1]?.rank),
          weekDiff: diff(latest?.rank, history[7]?.rank),
          recentRanks: recent.map(snapshot => snapshot.rank),
          recentPoints: recent.map(snapshot => ({ day: snapshot.checkedOn, rank: snapshot.rank, isError: snapshot.status === 'error' })),
          isChecking: isPendingCheck(keyword.pendingCheckAt),
        }
      })
      .sort((a, b) => a.storeName.localeCompare(b.storeName, 'ja') || a.keyword.keyword.localeCompare(b.keyword.keyword, 'ja')))

  async function createKeyword(input: { storeId: string; keyword: string; searchLocation: SearchLocation }) {
    if (!isMock) {
      return callFunction<unknown, { id: string; keyword: string; isChecking: boolean }>($functions, 'createRankKeyword', { orgId: orgId.value, ...input })
    }
    await mockLatency(800)
    return createRankKeywordFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
  }

  async function setActive(keywordId: string, isActive: boolean) {
    if (!isMock) {
      await callFunction($functions, 'updateRankKeywordActive', { orgId: orgId.value, keywordId, isActive })
      return
    }
    await mockLatency()
    updateRankKeywordActiveFunc(db.value, user.value!.uid, orgId.value, keywordId, isActive)
  }

  async function deleteKeyword(keywordId: string) {
    if (!isMock) {
      await callFunction($functions, 'deleteRankKeyword', { orgId: orgId.value, keywordId })
      return
    }
    await mockLatency()
    deleteRankKeywordFunc(db.value, user.value!.uid, orgId.value, keywordId)
  }

  /** 本物モードは計測を受け付けるだけ（結果は購読で届く）。モックはその場で終える */
  async function checkNow(keywordId: string): Promise<'done' | 'started'> {
    if (!isMock) {
      await callFunction($functions, 'postRankCheck', { orgId: orgId.value, keywordId })
      return 'started'
    }
    await mockLatency(1000)
    postRankCheckFunc(db.value, user.value!.uid, orgId.value, keywordId)
    return 'done'
  }

  return { rows, createKeyword, setActive, deleteKeyword, checkNow }
}
```

- [ ] **Step 4: `useRankHistory` を置き換える**

`app/composables/useRankHistory.ts`:

```ts
import { doc, getDoc } from 'firebase/firestore'
import type { RankResult, RankSnapshot } from '~/types/domain'
import { toRankResults } from '~/utils/firebase/converters'
import { errorMessageOf } from '~/utils/mock/functions/shared'
import { RANK_CHECK_RANGE } from '~/utils/mock/rank'

// F-17 1 キーワードの順位推移と、計測日の上位 20 件（競合）

export const RANK_PERIODS = [7, 30, 90] as const
export type RankPeriod = typeof RANK_PERIODS[number]

/** 計測範囲（この順位より下は圏外） */
export const RANK_RANGE = RANK_CHECK_RANGE

export function useRankHistory(keywordId: string) {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { orgId, canAccessStore, storeName } = useCurrentOrg()
  const { $db } = useNuxtApp()

  const keyword = computed(() => {
    const found = db.value.rankKeywords.find(item => item.id === keywordId && item.orgId === orgId.value)
    return found && canAccessStore(found.storeId) ? found : null
  })
  const period = ref<RankPeriod>(30)

  const history = computed<RankSnapshot[]>(() =>
    db.value.rankSnapshots
      .filter(snapshot => snapshot.keywordId === keywordId)
      .sort((a, b) => a.checkedOn.localeCompare(b.checkedOn)))

  /** 選択期間の履歴（古い順） */
  const periodHistory = computed(() => history.value.slice(-period.value))
  const latest = computed(() => history.value[history.value.length - 1] ?? null)

  const selectedDay = ref<string | null>(null)
  const selectedSnapshot = computed(() =>
    history.value.find(snapshot => snapshot.checkedOn === selectedDay.value) ?? latest.value)

  // 20 件の結果は購読せず、日付を選んだときに 1 件だけ読む（購読を軽く保つ）
  const results = ref<RankResult[]>([])
  const isLoadingResults = ref(false)
  const resultsError = ref<string | null>(null)
  let requestId = 0

  async function loadResults(day: string): Promise<RankResult[]> {
    if (isMock) return db.value.rankResults.find(item => item.keywordId === keywordId && item.checkedOn === day)?.results ?? []
    const snapshot = await getDoc(doc($db, `organizations/${orgId.value}/rankResults/${keywordId}_${day}`))
    return snapshot.exists() ? toRankResults(snapshot.data()).results : []
  }

  watch(() => (selectedSnapshot.value?.status === 'ok' ? `${selectedSnapshot.value.checkedOn}|${selectedSnapshot.value.checkedAt}` : null), async (key) => {
    const currentRequest = ++requestId
    results.value = []
    resultsError.value = null
    const day = key?.split('|')[0]
    if (!day || !keyword.value) return
    isLoadingResults.value = true
    try {
      const loaded = await loadResults(day)
      // 読み込み中に別の日付が選ばれたら、古い結果は捨てる
      if (currentRequest === requestId) results.value = loaded
    }
    catch (error) {
      if (currentRequest === requestId) resultsError.value = errorMessageOf(error)
    }
    finally {
      if (currentRequest === requestId) isLoadingResults.value = false
    }
  }, { immediate: true })

  const bestRank = computed(() => {
    const ranks = periodHistory.value.map(item => item.rank).filter((rank): rank is number => rank !== null)
    return ranks.length > 0 ? Math.min(...ranks) : null
  })

  return {
    keyword,
    storeName: computed(() => (keyword.value ? storeName(keyword.value.storeId) : '')),
    period,
    history,
    periodHistory,
    latest,
    bestRank,
    selectedDay,
    selectedSnapshot,
    results,
    isLoadingResults,
    resultsError,
  }
}
```

（watch のキーに `checkedAt` を含めるのは、同じ日を手動で再計測したときに結果を読み直すため。）

- [ ] **Step 5: `useRankSearch` を作る**

`app/composables/useRankSearch.ts`:

```ts
import type { RankSearch, SearchLocation } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { completeMockRankSearch, createRankSearchFunc } from '~/utils/mock/functions/rankings'
import { mockLatency } from '~/utils/mock/functions/shared'

// その場計測（キーワードを登録せずに地域 + キーワードで計測する）。owner / admin のみ

/** モックで計測にかかる時間（本番は 10 秒前後） */
const MOCK_CHECK_MS = 2000

export function useRankSearch() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  /** 直近 30 件（新しい順） */
  const searches = computed<RankSearch[]>(() =>
    db.value.rankSearches
      .filter(item => item.orgId === orgId.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30))

  const currentId = ref<string | null>(null)
  const current = computed(() => searches.value.find(item => item.id === currentId.value) ?? null)

  async function startSearch(input: { keyword: string; searchLocation: SearchLocation; storeId: string | null }): Promise<void> {
    if (!isMock) {
      const { id } = await callFunction<unknown, { id: string }>($functions, 'createRankSearch', { orgId: orgId.value, ...input })
      currentId.value = id
      return
    }
    await mockLatency()
    const search = createRankSearchFunc(db.value, user.value!.uid, { orgId: orgId.value, ...input })
    currentId.value = search.id
    void mockLatency(MOCK_CHECK_MS).then(() => completeMockRankSearch(db.value, search.id))
  }

  function select(searchId: string): void {
    currentId.value = searchId
  }

  return { searches, current, startSearch, select }
}
```

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: 残るエラーは `app/pages/admin/[orgId]/rankings/*.vue`（`competitors` などの旧名）と `KeywordFormModal.vue` だけ（Task 11 で直す）。

---

### Task 11: 推移グラフ・結果の表・キーワード登録・一覧と推移の画面

**Files:**
- Modify: `app/components/Ranking/Common/RankTrendChart.vue`
- Create: `app/components/Ranking/Common/RankResultsTable.vue`
- Modify（全体を置き換え）: `app/components/Ranking/Rankings/KeywordFormModal.vue`
- Modify: `app/pages/admin/[orgId]/rankings/index.vue`
- Modify: `app/pages/admin/[orgId]/rankings/[keywordId].vue`

**Interfaces:**
- Consumes：Task 9 の `RankingInputAreaSelect` / `nearestMunicipality` / `findMunicipalityByLabel`、Task 10 の composable、Task 8 の `rankKeyword.ts`
- Produces:
  - `RankPoint` に `isError?: boolean` を追加する
  - `<RankingCommonRankResultsTable :results="RankResult[]" :own-rank="number | null" />`
  - `KeywordFormModal` の props に `initialKeyword?: string`、`initialArea?: Municipality | null` を追加する

- [ ] **Step 1: 推移グラフにエラーの日を足す**

`app/components/Ranking/Common/RankTrendChart.vue`:

1. 冒頭のコメント 3 行目の下に、`// 取得エラー（isError）の日も圏外帯に置き、色を変える（圏外とは区別する）。` を追加する。`RankPoint` に `isError?: boolean` を追加する（`rank: number | null` の下）。
2. `rankLabel` を次の内容に置き換え、引数を点（`RankPoint`）に変える:

```ts
function rankLabel(point: RankPoint): string {
  if (point.isError) return '取得エラー'
  return point.rank === null ? `${props.range}位圏外` : `${point.rank}位`
}
```

3. 呼び出し側を置き換える。
   - `summaryLabel` 内の `rankLabel(latest.rank)` → `rankLabel(latest)`
   - テンプレートの `{{ rankLabel(lastPoint.rank) }}` → `{{ rankLabel(lastPoint) }}`
   - テンプレートの `{{ rankLabel(activePoint.rank) }}` → `{{ rankLabel(activePoint) }}`
4. spark の圏外の点 `<circle v-if="point.rank === null" :cx="xAt(index)" :cy="outY" r="1.5" class="fill-slate-300" />` を、次の内容に置き換える:

```vue
      <circle v-if="point.rank === null" :cx="xAt(index)" :cy="outY" r="1.5" :class="point.isError ? 'fill-amber-400' : 'fill-slate-300'" />
```

5. full の `<!-- 圏外の日 -->` の点を、次の内容に置き換える:

```vue
        <!-- 圏外・取得エラーの日 -->
        <template v-for="(point, index) in points" :key="point.day">
          <circle v-if="point.rank === null" :cx="xAt(index)" :cy="outY" r="3" :class="point.isError ? 'fill-amber-400' : 'fill-slate-400'" />
        </template>
```

6. 圏外帯のラベル `<text ...>圏外</text>` はそのまま残す。グラフの `UiCommonCard` の説明文で凡例を補う（Step 5）。

- [ ] **Step 2: 結果の表を作る**

`app/components/Ranking/Common/RankResultsTable.vue`:

```vue
<script setup lang="ts">
import type { RankResult } from '~/types/domain'

// 計測結果の 1〜20 位（競合一覧）。推移画面とその場計測で使う

interface Props {
  results: RankResult[]
  /** 自店の順位（強調表示する）。圏外・店舗指定なしは null */
  ownRank?: number | null
}

withDefaults(defineProps<Props>(), { ownRank: null })

function ratingText(result: RankResult): string {
  return result.rating === null ? '—' : `★${result.rating.toFixed(1)}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[520px] text-sm">
      <thead class="bg-slate-50 text-left text-xs text-slate-500">
        <tr>
          <th scope="col" class="w-14 px-4 py-2.5 text-right font-medium">順位</th>
          <th scope="col" class="px-3 py-2.5 font-medium">ビジネス名</th>
          <th scope="col" class="px-3 py-2.5 font-medium">カテゴリ</th>
          <th scope="col" class="px-3 py-2.5 text-right font-medium">評価</th>
          <th scope="col" class="px-4 py-2.5 text-right font-medium">口コミ数</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        <tr v-for="result in results" :key="result.rank" :class="result.rank === ownRank ? 'bg-brand-50' : ''">
          <td class="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-500">{{ result.rank }}</td>
          <th scope="row" class="px-3 py-2.5 text-left font-normal">
            <span class="flex items-center gap-2">
              <span class="min-w-0 truncate" :class="result.rank === ownRank ? 'font-semibold text-brand-800' : 'text-slate-800'">{{ result.name }}</span>
              <UiCommonBadge v-if="result.rank === ownRank" tone="brand">自店</UiCommonBadge>
            </span>
          </th>
          <td class="px-3 py-2.5 text-xs text-slate-500">{{ result.category ?? '—' }}</td>
          <td class="px-3 py-2.5 text-right tabular-nums text-slate-700">{{ ratingText(result) }}</td>
          <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ result.reviewCount === null ? '—' : `${result.reviewCount.toLocaleString('ja-JP')}件` }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 3: キーワード登録のモーダルを置き換える**

`app/components/Ranking/Rankings/KeywordFormModal.vue`:

```vue
<script setup lang="ts">
import { nearestMunicipality, type Municipality } from '~/utils/geo/municipality'
import { KEYWORD_MAX_LENGTH, keywordErrorOf } from '~/utils/rankKeyword'

// F-15 順位キーワードの追加。検索地点は市区町村から選ぶ（既定は店舗に最も近い市区町村）

interface Props {
  /** 開いたときに選択しておく店舗 */
  initialStoreId?: string | null
  /** その場計測から登録するときのキーワードと地域 */
  initialKeyword?: string
  initialArea?: Municipality | null
}

const props = withDefaults(defineProps<Props>(), { initialStoreId: null, initialKeyword: '', initialArea: null })
const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [keyword: string, isChecking: boolean] }>()

const { visibleStores } = useCurrentOrg()
const { createKeyword } = useRankKeywords()
const state = useActionState()

const storeId = ref('')
const keyword = ref('')
const area = ref<Municipality | null>(null)
const keywordError = ref<string | null>(null)
const areaError = ref<string | null>(null)

const storeOptions = computed(() => visibleStores.value.map(store => ({ value: store.id, label: store.name })))

function onApplyStoreArea(): void {
  const store = visibleStores.value.find(item => item.id === storeId.value)
  if (store) area.value = nearestMunicipality(store.lat, store.lng)
}

function onReset(): void {
  storeId.value = props.initialStoreId ?? visibleStores.value[0]?.id ?? ''
  keyword.value = props.initialKeyword
  keywordError.value = null
  areaError.value = null
  state.errorMessage.value = null
  if (props.initialArea) area.value = props.initialArea
  else onApplyStoreArea()
}

watch(isOpen, (value) => {
  if (value) onReset()
})

/** 利用者が店舗を変えたときだけ地域を合わせ直す（onReset の initialArea を上書きしないよう watch は使わない） */
function onChangeStore(value: string): void {
  storeId.value = value
  onApplyStoreArea()
}

function validate(): boolean {
  keywordError.value = keywordErrorOf(keyword.value)
  areaError.value = area.value ? null : '地域を候補から選んでください'
  return keywordError.value === null && areaError.value === null
}

async function onSubmit(): Promise<void> {
  if (!validate() || !area.value) return
  const created = await state.run(() => createKeyword({
    storeId: storeId.value,
    keyword: keyword.value,
    searchLocation: { lat: area.value!.lat, lng: area.value!.lng, label: area.value!.label },
  }))
  if (!created) return
  emit('created', created.keyword, created.isChecking)
  isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" title="キーワードを追加">
    <form id="keyword-form" class="space-y-4" @submit.prevent="onSubmit">
      <UiInputSelectField :model-value="storeId" label="店舗" :options="storeOptions" @update:model-value="onChangeStore" />
      <UiInputTextField
        v-model="keyword"
        label="キーワード"
        placeholder="例: 渋谷 定食"
        hint="Google マップで検索される語句を入力します。スペースで区切ると AND 検索になります（2〜100 文字）"
        :error="keywordError"
        is-required
        :maxlength="KEYWORD_MAX_LENGTH"
      />
      <RankingInputAreaSelect v-model="area" label="検索地点（地域）" :error="areaError" />
      <div class="flex flex-wrap items-center gap-2">
        <UiCommonButton size="sm" variant="ghost" icon="map-pin" @click="onApplyStoreArea">店舗の所在地に戻す</UiCommonButton>
      </div>
      <p class="text-xs text-slate-500">
        地点が変わると過去の順位と比較できなくなるため、登録後に地点は変更できません。別の地点で計測したい場合は、別のキーワードとして追加してください。
      </p>
      <UiCommonAlert v-if="state.errorMessage.value" tone="danger">{{ state.errorMessage.value }}</UiCommonAlert>
    </form>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton type="submit" form="keyword-form" :is-loading="state.isPending.value">追加して計測する</UiCommonButton>
    </template>
  </UiCommonModal>
</template>
```

- [ ] **Step 4: 一覧の画面を直す**

`app/pages/admin/[orgId]/rankings/index.vue`:

1. `<script setup>` の `import type { KeywordRow }` の下に、`import { RANK_DISCLAIMER } from '~/utils/rankKeyword'` を追加する。
2. `rankText` を次の内容に置き換える:

```ts
function rankText(row: KeywordRow): string {
  if (row.latest?.status === 'error') return '取得エラー'
  return row.latest?.rank == null ? `${RANK_RANGE}位圏外` : `${row.latest.rank}位`
}
```

3. `onCheckNow` の結果の通知を次のように変える:

```ts
async function onCheckNow(row: KeywordRow): Promise<void> {
  checkingId.value = row.keyword.id
  const outcome = await actionState.run(() => checkNow(row.keyword.id))
  checkingId.value = null
  if (actionState.errorMessage.value) show(actionState.errorMessage.value, 'danger')
  else show(outcome === 'started' ? `「${row.keyword.keyword}」の計測を開始しました（10 秒ほどで反映されます）` : `「${row.keyword.keyword}」を計測しました`)
}
```

4. `onCreated` を次の内容に置き換える:

```ts
function onCreated(keyword: string, isChecking: boolean): void {
  show(isChecking ? `「${keyword}」を追加し、初回の計測を開始しました` : `「${keyword}」を追加しました（今月の計測数の上限に達しているため、計測は来月から行います）`)
}
```

5. テンプレートを次のように変える。
   - ページの見出しの `#actions`：「キーワードを追加」ボタンの前に、`<UiCommonButton variant="secondary" icon="refresh" :to="adminPath('/rankings/search')">その場で計測</UiCommonButton>` を置く（`UiCommonButton` は `to` で NuxtLink として描画される）。
   - `<UiCommonAlert tone="info">計測地点・端末・パーソナライズにより実際の表示と異なる場合があります。</UiCommonAlert>`：本文を `{{ RANK_DISCLAIMER }}` に変える。
   - 最新順位のセル：`{{ rankText(row.latest?.rank) }}` を `{{ rankText(row) }}` にする。色のクラスを `row.latest?.status === 'error' ? 'text-amber-700' : row.latest?.rank == null ? 'text-slate-500' : 'text-slate-900'` にする。
   - キーワード名の下のバッジ：`<UiCommonBadge v-if="!row.keyword.isActive">停止中</UiCommonBadge>` の後ろに、`<UiCommonBadge v-if="row.isChecking" tone="brand">計測中</UiCommonBadge>` を追加する。
   - 今すぐ計測のボタン：`:is-loading="checkingId === row.keyword.id || row.isChecking"`、`:is-disabled="!row.keyword.isActive || row.isChecking"` にする。

`UiCommonBadge` に `tone="brand"` があることは、既存の `[keywordId].vue` で確認済み。

- [ ] **Step 5: 推移の画面を直す**

`app/pages/admin/[orgId]/rankings/[keywordId].vue`:

1. `<script setup>` の冒頭の import に、`import { RANK_DISCLAIMER, rankErrorText } from '~/utils/rankKeyword'` を追加する。
2. `useRankHistory` の分割代入で `competitors, isLoadingCompetitors, competitorsError` を `results, isLoadingResults, resultsError` に変える。`const { findStore } = useStores()` と `const store = computed(...)` の 2 行は削除する（自店の判定は `selectedSnapshot.rank` を使う）。
3. `chartPoints` を `periodHistory.value.map(snapshot => ({ day: snapshot.checkedOn, rank: snapshot.rank, isError: snapshot.status === 'error' }))` にする。
4. `outOfRangeDays` を `periodHistory.value.filter(snapshot => snapshot.status === 'ok' && snapshot.rank === null).length` にする。その下に `const errorDays = computed(() => periodHistory.value.filter(snapshot => snapshot.status === 'error').length)` を追加する。
5. `rankText` を次の内容に置き換える:

```ts
function rankText(snapshot: RankSnapshot | null | undefined): string {
  if (snapshot?.status === 'error') return '取得エラー'
  return snapshot?.rank == null ? `${RANK_RANGE}位圏外` : `${snapshot.rank}位`
}
```

あわせて `import type { RankSnapshot } from '~/types/domain'` を追加する。テンプレートの `rankText(latest?.rank)` を `rankText(latest)` に、`rankText(row.snapshot.rank)` を `rankText(row.snapshot)` に変える。

6. テンプレートを次のように変える。
   - 注意書きの `UiCommonAlert` の本文を `{{ RANK_DISCLAIMER }}` にする。
   - 「圏外だった日」の StatCard の `sub` を、`` `${periodHistory.length} 日中${errorDays > 0 ? `・取得エラー ${errorDays} 日` : ''}` `` にする。
   - 推移グラフの `UiCommonCard` の `description` を、「グラフの日付をクリックすると、その日の上位 20 店舗を表示します（上が 1 位。下端の灰色は圏外、黄色は取得エラーの日）」にする。
   - 「上位の店舗」カードの全体を、次の内容に置き換える:

```vue
      <UiCommonCard
        title="上位の店舗"
        :description="selectedSnapshot ? `${formatDate(`${selectedSnapshot.checkedOn}T00:00:00`)} の計測結果（上位 ${selectedSnapshot.resultCount} 件）` : undefined"
        is-flush
      >
        <p v-if="!selectedSnapshot" class="p-5 text-sm text-slate-500">計測結果がありません。</p>
        <div v-else-if="selectedSnapshot.status === 'error'" class="p-5">
          <UiCommonAlert tone="warning">{{ rankErrorText(selectedSnapshot.errorCode) }}。この日の順位と上位店舗は取得できませんでした。</UiCommonAlert>
        </div>
        <p v-else-if="isLoadingResults" class="p-5 text-sm text-slate-500" role="status">上位店舗を読み込んでいます…</p>
        <div v-else-if="resultsError" class="p-5">
          <UiCommonAlert tone="danger">{{ resultsError }}</UiCommonAlert>
        </div>
        <RankingCommonRankResultsTable v-else :results="results" :own-rank="selectedSnapshot.rank" />
        <p v-if="selectedSnapshot && selectedSnapshot.status === 'ok' && selectedSnapshot.rank === null" class="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          この日は自店が {{ RANK_RANGE }} 位以内に表示されませんでした。
        </p>
      </UiCommonCard>
```

   - 日別の表の「順位」セルを、エラーなら色を変える:

```vue
<td class="px-3 py-2 text-right font-medium tabular-nums" :class="row.snapshot.status === 'error' ? 'text-amber-700' : ''">{{ rankText(row.snapshot) }}</td>
```

- [ ] **Step 6: 型チェックと画面の確認（モックモード）**

Run: `npm run typecheck`
Expected: エラーなし。

Run: `npm run dev` で `http://localhost:3000` を開き、モックのアカウントで `/admin/{orgId}/rankings` を確認する。
- 一覧
  - 地点の欄に「東京都渋谷区」などの市区町村名が出る。
  - 30 日の推移に黄色の点（取得エラー）が混ざっているキーワードがある。
  - 今すぐ計測を押すと「計測しました」と表示される。
- キーワード追加
  - 地域の欄に「渋谷」と入力すると候補が出て、矢印キーと Enter で選べる。
  - 「渋」の 1 文字だと「キーワードは 2〜100 文字で入力してください」と出る。
  - 地域を消すと「地域を候補から選んでください」と出る。
- 推移の画面
  - グラフの日付を選ぶと、20 件の表（順位／ビジネス名／カテゴリ／評価／口コミ数）が出る。自店の行は強調される。
  - エラーの日を選ぶと「取得エラー…」の注意が出る。
- ダッシュボード（`/admin/{orgId}`）の順位の小さなグラフも、これまでどおり表示される。
- ブラウザのコンソールに `Failed to resolve component` が出ていない（`RankingInputAreaSelect` / `RankingCommonRankResultsTable`）。

---

### Task 12: その場計測の画面と本接続の範囲

**Files:**
- Create: `app/components/Ranking/Search/SearchForm.vue`
- Create: `app/pages/admin/[orgId]/rankings/search.vue`
- Modify: `app/composables/useAdminNav.ts:29`（`FIREBASE_READY_PATHS`）

**Interfaces:**
- Consumes:
  - Task 10：`useRankSearch`
  - Task 9：`RankingInputAreaSelect` / `nearestMunicipality` / `Municipality`
  - Task 11：`RankingCommonRankResultsTable`、`KeywordFormModal`（`initialKeyword` / `initialArea`）
  - Task 8：`keywordErrorOf` / `KEYWORD_MAX_LENGTH` / `RANK_DISCLAIMER` / `rankErrorText`
- Produces:
  - `<RankingSearchSearchForm :is-pending @submit="(input) => void" />`
    - `input: { keyword: string; area: Municipality; storeId: string | null }`

- [ ] **Step 1: 入力フォームを作る**

`app/components/Ranking/Search/SearchForm.vue`:

```vue
<script setup lang="ts">
import { nearestMunicipality, type Municipality } from '~/utils/geo/municipality'
import { KEYWORD_MAX_LENGTH, keywordErrorOf } from '~/utils/rankKeyword'

// その場計測の入力（地域・キーワード・店舗は任意）

interface Props {
  isPending?: boolean
}

withDefaults(defineProps<Props>(), { isPending: false })
const emit = defineEmits<{ submit: [input: { keyword: string; area: Municipality; storeId: string | null }] }>()

const { visibleStores } = useCurrentOrg()
const NO_STORE = ''
const storeId = ref(NO_STORE)
const keyword = ref('')
const area = ref<Municipality | null>(null)
const keywordError = ref<string | null>(null)
const areaError = ref<string | null>(null)

const storeOptions = computed(() => [
  { value: NO_STORE, label: '指定しない（上位 20 件だけ見る）' },
  ...visibleStores.value.map(store => ({ value: store.id, label: store.name })),
])

watch(storeId, (value) => {
  const store = visibleStores.value.find(item => item.id === value)
  if (store) area.value = nearestMunicipality(store.lat, store.lng) ?? area.value
})

function onSubmit(): void {
  keywordError.value = keywordErrorOf(keyword.value)
  areaError.value = area.value ? null : '地域を候補から選んでください'
  if (keywordError.value || !area.value) return
  emit('submit', { keyword: keyword.value, area: area.value, storeId: storeId.value === NO_STORE ? null : storeId.value })
}
</script>

<template>
  <form class="grid gap-4 md:grid-cols-2" @submit.prevent="onSubmit">
    <RankingInputAreaSelect v-model="area" :error="areaError" />
    <UiInputSelectField v-model="storeId" label="店舗（任意）" :options="storeOptions" />
    <div class="md:col-span-2">
      <UiInputTextField
        v-model="keyword"
        label="キーワード"
        placeholder="例: 渋谷 カフェ"
        hint="スペースで区切ると AND 検索になります（2〜100 文字）"
        :error="keywordError"
        is-required
        :maxlength="KEYWORD_MAX_LENGTH"
      />
    </div>
    <div class="md:col-span-2">
      <UiCommonButton type="submit" icon="refresh" :is-loading="isPending">順位を計測する</UiCommonButton>
    </div>
  </form>
</template>
```

- [ ] **Step 2: 画面を作る**

`app/pages/admin/[orgId]/rankings/search.vue`:

```vue
<script setup lang="ts">
import type { RankSearch } from '~/types/domain'
import { findMunicipalityByLabel, type Municipality } from '~/utils/geo/municipality'
import { RANK_DISCLAIMER, rankErrorText } from '~/utils/rankKeyword'

// その場計測。キーワードを登録せずに、地域 + キーワードで Google マップの上位 20 件を計測する（owner / admin）

definePageMeta({ layout: 'admin' })
useHead({ title: 'その場で計測' })

const { canManage, adminPath, storeName } = useCurrentOrg()
const { searches, current, startSearch, select } = useRankSearch()
const { show } = useToast()
const state = useActionState()

const isRegisterOpen = ref(false)
const registerArea = ref<Municipality | null>(null)

const isRunning = computed(() => current.value?.status === 'queued' || current.value?.status === 'running')

async function onSubmit(input: { keyword: string; area: Municipality; storeId: string | null }): Promise<void> {
  await state.run(() => startSearch({
    keyword: input.keyword,
    searchLocation: { lat: input.area.lat, lng: input.area.lng, label: input.area.label },
    storeId: input.storeId,
  }))
  if (state.errorMessage.value) show(state.errorMessage.value, 'danger')
}

function rankText(search: RankSearch): string {
  if (search.status === 'error') return '取得エラー'
  if (search.status !== 'done') return '計測中'
  if (!search.storeId) return '—'
  return search.rank === null ? '圏外' : `${search.rank}位`
}

function onOpenRegister(search: RankSearch): void {
  registerArea.value = findMunicipalityByLabel(search.searchLocation.label)
  isRegisterOpen.value = true
}

function onRegistered(keyword: string): void {
  show(`「${keyword}」を定期計測に追加しました`)
}
</script>

<template>
  <div v-if="!canManage" class="space-y-4">
    <UiCommonPageHeader title="その場で計測" :back-to="adminPath('/rankings')" back-label="順位一覧へ" />
    <UiCommonAlert tone="warning">その場計測は owner / admin のみ利用できます。</UiCommonAlert>
  </div>

  <div v-else class="space-y-6">
    <UiCommonPageHeader
      title="その場で計測"
      description="キーワードを登録せずに、Google マップでの上位 20 件と自店の順位をその場で確認します"
      :back-to="adminPath('/rankings')"
      back-label="順位一覧へ"
    />
    <UiCommonAlert tone="info">{{ RANK_DISCLAIMER }}1 回の計測で、今月の順位計測数を 1 回使います。</UiCommonAlert>

    <UiCommonCard title="計測する条件">
      <RankingSearchSearchForm :is-pending="state.isPending.value || isRunning" @submit="onSubmit" />
    </UiCommonCard>

    <UiCommonCard v-if="current" :title="`“${current.keyword}”の順位計測`" :description="`${current.searchLocation.label}${current.storeId ? `・${storeName(current.storeId)}` : ''}`" is-flush>
      <div class="flex items-baseline gap-3 px-5 py-4">
        <span class="text-sm text-slate-500">検索順位</span>
        <span class="text-2xl font-semibold tabular-nums" :class="current.status === 'error' ? 'text-amber-700' : 'text-slate-900'">{{ rankText(current) }}</span>
      </div>
      <p v-if="isRunning" class="border-t border-slate-100 px-5 py-4 text-sm text-slate-500" role="status">計測中…（10 秒ほどかかります）</p>
      <div v-else-if="current.status === 'error'" class="border-t border-slate-100 p-5">
        <UiCommonAlert tone="warning">{{ rankErrorText(current.errorCode) }}。しばらく時間を置いてから再度お試しください。</UiCommonAlert>
      </div>
      <template v-else>
        <p v-if="current.results.length === 0" class="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">検索結果がありませんでした。</p>
        <RankingCommonRankResultsTable v-else :results="current.results" :own-rank="current.rank" />
        <div v-if="current.storeId" class="flex justify-end border-t border-slate-100 px-5 py-3">
          <UiCommonButton size="sm" variant="secondary" icon="plus" @click="onOpenRegister(current)">このキーワードを登録</UiCommonButton>
        </div>
      </template>
    </UiCommonCard>

    <UiCommonCard title="最近の計測" description="直近 30 日・30 件まで" is-flush>
      <p v-if="searches.length === 0" class="p-5 text-sm text-slate-500">まだ計測していません。</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="search in searches" :key="search.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-slate-50"
            :class="search.id === current?.id ? 'bg-brand-50' : ''"
            @click="select(search.id)"
          >
            <span class="min-w-0 flex-1 truncate font-medium text-slate-800">{{ search.keyword }}</span>
            <span class="text-xs text-slate-500">{{ search.searchLocation.label }}</span>
            <span class="w-16 text-right tabular-nums text-slate-700">{{ rankText(search) }}</span>
            <span class="w-28 text-right text-xs text-slate-400">{{ formatDate(search.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </UiCommonCard>

    <RankingRankingsKeywordFormModal
      v-model="isRegisterOpen"
      :initial-store-id="current?.storeId ?? null"
      :initial-keyword="current?.keyword ?? ''"
      :initial-area="registerArea"
      @created="onRegistered"
    />
  </div>
</template>
```

`formatDate` が ISO 文字列を受け付けることは、既存の `formatDate(`${day}T00:00:00`)` の使い方で確認済み。

- [ ] **Step 3: 本物モードで順位の画面を開けるようにする**

`app/composables/useAdminNav.ts:29` を、次の内容に置き換える:

```ts
const FIREBASE_READY_PATHS = ['/settings/organization', '/settings/members', '/settings/google', '/stores', '/profiles', '/reviews', '/posts', '/rankings']
```

- [ ] **Step 4: 型チェックと画面の確認（モックモード）**

Run: `npm run typecheck`
Expected: エラーなし。

Run: `npm run dev` で、モックの owner のアカウントで確認する。
- 一覧の「その場で計測」から `/admin/{orgId}/rankings/search` を開く。
- 地域「東京都渋谷区」、店舗「指定しない」、キーワード「渋谷　カフェ」で計測する。
  - 「計測中…」が約 2 秒出たあと、20 件の表が出る。順位の欄は「—」。
  - 最近の計測に「渋谷 カフェ」（全角スペースは半角に変換済み）が並ぶ。
- 店舗を指定して計測する。
  - 自店の行が強調され、「このキーワードを登録」で、キーワードと地域が入った追加のモーダルが開く。
- staff のアカウントでは「owner / admin のみ」と出て、一覧にも「その場で計測」のボタンが出ない（`canManage` の `#actions` の中にあるため）。
- コンソールに `Failed to resolve component`（`RankingSearchSearchForm`）が出ていない。

---

### Task 13: 本物モードの通し確認とドキュメント

**Files:**
- Modify: `.claude/PROJECT.md`（Functions・Firestore の節）
- Modify: `docs/05-open-issues.md`（I-07 / I-19 / I-26）
- Modify: `docs/02-database.md`、`docs/03-pages.md`、`docs/04-features.md`、`docs/06-cost-estimate.md`
- Modify: `docs/superpowers/specs/2026-10-08-rank-scraping-design.md`（4.2 の `scripts/probe.ts` を `__tests__/probe.ts` に、状態を「実装済み」に）

- [ ] **Step 1: Emulator で本物モードを通して確認する**

Run（2 つのターミナルで）:
```bash
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH OAUTH_CALLBACK_URL=http://127.0.0.1:5001/meo-tool-d98e5/asia-northeast1/googleOAuthCallback ADMIN_APP_URL=http://localhost:3000 CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" firebase emulators:start --only auth,firestore,functions,storage
NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=true npm run dev
```

確認すること:
- 店舗のある組織で `/rankings` を開いてキーワードを追加する。
  - 一覧に「計測中」が出て、10 秒前後で順位（または圏外）に変わる。
  - Functions Emulator は Cloud Tasks のキューを Emulator 内で実行する。
- 推移の画面で、その日の 20 件が出る。
- `/rankings/search` でその場計測ができる。
- Emulator UI（`http://127.0.0.1:4000/firestore`）で、`rankSnapshots/{keywordId}_{日付}` と `rankResults/...`、`usageMonthly/{YYYYMM}.rankChecks` が増えている。

Emulator でタスクキューが動かない場合（`taskQueue` の投入でエラーになる）は、そのエラーを記録する。Functions Emulator のバージョンの確認が必要だとユーザーに伝え、Step 2 以降へ進む（ここで実装を変えない）。

- [ ] **Step 2: PROJECT.md に追記する**

`.claude/PROJECT.md` の「Functions」の表の `フォルダ` の行を、次のように変える:

`identity/`（組織・招待・メンバー）、`shared/`（権限・検証・監査ログ・callable ラッパー）、`shared/gbp/`（汎用 GBP クライアント。Firebase 非依存）、`rankings/`（順位計測。Google マップのスクレイピング・Cloud Tasks のワーカー）

同じ節の末尾（「Functions の環境変数」の前）に追加する:

```markdown
### 順位計測（rankings/）

- 毎朝 4:00（JST）に `scheduledRankCheck` が有効なキーワードを Cloud Tasks に投入し、`rankCheckWorker`（2GiB・同時 2 件・5 秒に 1 件）が Google マップを Headless Chrome（`puppeteer-core` + `@sparticuz/chromium`）で計測する
- 画面の「今すぐ計測」「その場で計測」も同じワーカーに投入する（callable は受け付けだけ）
- Google マップの画面構造が変わったら `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm --prefix functions run rank:probe -- "渋谷 カフェ" 35.664 139.698` で実画面を確認し、`functions/src/rankings/providers/gmapsScraper.ts`（抜き出し）と `parseGmapsItems.ts`（解析）を直す
- 本番デプロイ前に Cloud Tasks API を有効にし、Functions の実行サービスアカウントに「Cloud Tasks エンキューア」ロールを付与する
- その場計測（`rankSearches`）は `expireAt` の TTL で 30 日後に消える。初回のみ設定する: `gcloud firestore fields ttls update expireAt --collection-group=rankSearches --enable-ttl --project=meo-tool-d98e5`
- 取得元は Google の利用規約上の自動取得にあたる（`docs/05-open-issues.md` I-07）。取得元を替えるときは `RankProvider`（`providers/rankProvider.ts`）の実装だけを差し替える
```

「Firestore」の表に行を追加する:

```markdown
| 順位計測 | `rankKeywords/{id}`・`rankSnapshots/{keywordId}_{日付}`（直近 90 日を購読）・`rankResults/{keywordId}_{日付}`（日付を選んだときに読む）・`rankSearches/{id}`（owner / admin のみ）・`usageMonthly/{YYYYMM}`。トップレベルの `rankRuns/{日付}` は日次計測の集計（全拒否） |
```

`インデックス` の行に、`rankSnapshots (storeId, checkedOn)` と `rankKeywords.isActive` の collection group を追記する。

- [ ] **Step 3: 設計資料を更新する**

- `docs/05-open-issues.md`
  - I-07 の状態を「決着」にし、本文の末尾に次の文を加える：「2026-10-08: 自前で Google マップをスクレイピングする方式に決定（Functions 上の Headless Chrome）。規約違反とブロックのリスクを承知のうえで採用し、`RankProvider` で SERP API などに差し替えられるようにした（`docs/superpowers/specs/2026-10-08-rank-scraping-design.md`）。」
  - I-19 は「その場計測（`/rankings/search`）を実装したため解決」とする。
  - I-26 は「Places API を使わなくなったため解決」とする。
- `docs/02-database.md`：順位の節を、仕様書の 2 章（`rankKeywords` の追加項目、`rankSnapshots` / `rankResults` の分割、`rankSearches`、`rankRuns`、TTL）に合わせて書き換える。旧来の `snapshots` サブコレクションと `topPlaceIds` の記述は削除する。
- `docs/03-pages.md`
  - `rankings/search`（その場計測、owner / admin）を追加する。
  - KeywordFormModal のパスを `Ranking/Rankings/KeywordFormModal.vue` に直す。
  - 「地図で地点を指定」を「市区町村を選択」に変える。
- `docs/04-features.md`
  - F-15：地点は市区町村、キーワードは 2〜100 文字・AND 検索に変える。
  - F-16：取得方式・ワーカー・ブロック時の打ち切りを書く。
  - F-17：競合は計測結果の 20 件、`getRankCompetitorsFunc` は廃止、と書く。
  - その場計測の項を追加する。
- `docs/06-cost-estimate.md`
  - Place Details（競合一覧）の費用の行を削除する。
  - 代わりに「`rankCheckWorker`（2GiB・1 件 10 秒前後）× 月の計測回数」の Functions の実行費用と、Cloud Tasks の費用（月 100 万件まで無料）の行を追加する。
- 仕様書
  - 状態を「実装済み」にする。
  - 4.2 の `scripts/probe.ts` を `__tests__/probe.ts（npm run rank:probe）` に直す。
  - 3.3 に `maxDispatchesPerSecond: 0.2` を追記し、3.5 の「`scheduleDelaySeconds` で散らす」を「キューの `maxDispatchesPerSecond` で間隔を空ける」に直す。

- [ ] **Step 4: 最終確認**

Run:
```bash
npm --prefix functions run build && npm --prefix functions test && PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator && npm run typecheck && npm run build
```
Expected: すべて成功する。`npm run build` は Nuxt の本番ビルドで、警告に `Failed to resolve component` が出ない。

Run: `git status --short`
Expected: 計画の「ファイル構成」にあるファイルと、ドキュメントの更新だけが差分になっている。コミットはユーザーの許可がある場合のみ行う。
