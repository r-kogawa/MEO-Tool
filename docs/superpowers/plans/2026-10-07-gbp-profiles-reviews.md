# GBP プロフィール・口コミ返信 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面から GBP のプロフィールを一覧・同期・編集し、口コミを同期して個別・一括で返信できるようにする（返信テンプレート・毎日の自動同期を含む）。

**Architecture:** Functions の `gbp/` に業務処理を置き、計画 3 の `createGbpClientForConnection` / `withConnectionErrors` で GBP を呼ぶ。個別と一括は同じ関数で受け、`runBatch`（並列 3）で `{ succeeded, failed }` を返す。プロフィールの変換・検証は純粋関数に分けて単体テストする。結果は Firestore（`gbpProfiles` / `gbpReviews` / `replyTemplates`）にキャッシュし、クライアントは計画 2 の購読方式で読む。モックにも同じ機能を用意する。

**Tech Stack:** firebase-functions 7（onCall / onSchedule）/ firebase-admin 13 / 計画 1 の `GbpClient` / Nuxt 4

**Spec:** `docs/superpowers/specs/2026-10-07-gbp-integration-design.md`（4.3〜4.5・5・6・7 章のうちプロフィール・口コミ・テンプレート）

**前提（計画 1〜3 で確定済み）:** `GbpClient`（`getLocation` / `updateLocation` / `listAllReviews` / `updateReviewReply` / `deleteReviewReply`）、`toV4LocationPath` / `starRatingToNumber`、`createGbpClientForConnection(db, orgId, connectionId, deps)` / `withConnectionErrors(db, orgId, connectionId, run)` / `GoogleDeps` / `defaultGoogleDeps`、`createFakeGoogle`、`requireMember` / `requireStoreAccess` / `requireOrg`、`callable` / `writeAuditLog`、クライアントの `useAppDb` / `useFirestoreSync` / `callFunction` / `FIREBASE_READY_PATHS`

## Global Constraints

- 一括処理は並列 3。口コミの返信は 1 回 1〜50 件。結果は `{ succeeded: string[]; failed: { id: string; message: string }[] }`（`succeeded` は入力順）
- 部分失敗はエラーにしない（結果で返す）。入力不正・権限不足は全体をエラーにする
- 返信本文は空不可・4096 バイト以内。差し込み（`{投稿者名}` `{店舗名}`）はクライアントで展開してから送る
- プロフィールで編集できるのは 説明（750 文字以内）・電話番号・ウェブサイト・営業時間・特別営業時間。`updateMask` は変更した項目だけ
- 権限: プロフィール編集・テンプレート管理は owner / admin。同期・返信・返信削除はメンバー（staff は担当店舗のみ）
- 同期・一括返信の callable は `timeoutSeconds: 300`。自動同期は毎日 6:00（Asia/Tokyo）、`timeoutSeconds: 540`
- `gbpProfiles` のドキュメント ID は店舗 ID、`gbpReviews` は GBP の reviewId（`/` は `_` に置換）
- 本物モードで本接続する画面に `/profiles` と `/reviews` を加える
- モック（`NUXT_PUBLIC_USE_MOCK` 未設定）の既存画面を壊さない
- コミットはユーザーの許可がある場合のみ（現状: その場で実装・コミットなし）

## Review Focus

- **一括返信の一部だけ失敗**（1 件だけ GBP が 403）: 他は成功し、失敗分は理由付きで返り、画面で失敗分だけが選択状態に残る → Task 4 のテストと Task 10 のモック確認
- **日本語の長い返信**: 4096 文字ではなく 4096 バイトで判定する（日本語は約 1,365 文字） → Task 4 のテスト
- **staff が担当外の口コミに返信**: 1 件でも担当外が混ざれば全体を拒否し、GBP を呼ばない → Task 4 のテスト
- **営業時間の 24:00 閉店・未入力の 00:00**: GBP の `{ hours: 24 }` と `{}` を `24:00` / `00:00` と相互変換できる → Task 2 のテスト
- **評価のみの口コミ・匿名の投稿者**: 本文 null、投稿者名「匿名」で保存・表示する → Task 4 のテスト

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `functions/src/shared/runBatch.ts` | 並列数を制限した一括実行と結果の集計 |
| `functions/src/shared/audit.ts` | `addAuditLog`（トランザクション外の監査ログ）を追加 |
| `functions/src/shared/callable.ts` | `callable(handler, options?)` で `timeoutSeconds` などを渡せるようにする |
| `functions/src/gbp/profileMapping.ts` | GBP ロケーション ⇔ プロフィールの変換と編集内容の検証（純粋関数） |
| `functions/src/gbp/storeAccess.ts` | GBP 連携済み店舗の読み込み・権限確認・連携ごとのクライアント共有 |
| `functions/src/gbp/profiles.ts` | プロフィールの同期・更新 |
| `functions/src/gbp/reviews.ts` | 口コミの同期・返信・返信削除・自動同期 |
| `functions/src/gbp/templates.ts` | 返信テンプレートの CRUD |
| `functions/src/__tests__/fakeGoogle.ts` | 偽の GBP サーバー（ロケーション取得・更新、口コミ一覧・返信）を追加 |
| `firestore.rules` / `firestore.indexes.json` | 3 コレクションの読み取り規則・インデックス |
| `app/types/domain.ts` | `GbpProfile` / `GbpReview` / `ReplyTemplate` / `BatchResult` など |
| `app/utils/mock/seed.ts` / `app/utils/mock/functions/gbp.ts` / `app/utils/firebase/{emptyDb,converters}.ts` | モックとデータ変換 |
| `app/utils/replyTemplate.ts` | 差し込みの展開・バイト数 |
| `app/composables/useGbpProfiles.ts` / `useGbpReviews.ts` / `useReplyTemplates.ts` | 画面用の状態と操作 |
| `app/composables/useFirestoreSync.ts` / `useAdminNav.ts` | 購読の追加・ナビ |
| `app/components/Gbp/Input/RegularHoursEditor.vue` / `SpecialHoursEditor.vue` | 営業時間の入力 |
| `app/components/Gbp/Reviews/*.vue` | 口コミカード・返信フォーム・一括返信・テンプレート管理・星表示 |
| `app/pages/admin/[orgId]/profiles/index.vue` / `[storeId].vue` / `reviews/index.vue` | 画面 |

---

### Task 1: 一括実行・監査ログ・callable のオプション

**Files:**
- Create: `functions/src/shared/runBatch.ts`
- Modify: `functions/src/shared/audit.ts`、`functions/src/shared/callable.ts`
- Test: `functions/src/shared/__tests__/runBatch.test.ts`

**Interfaces:**
- Produces:
  - `interface BatchResult<TId> { succeeded: TId[]; failed: { id: TId; message: string }[] }`
  - `runBatch<TItem, TId>(items: TItem[], idOf: (item: TItem) => TId, worker: (item: TItem) => Promise<void>, options?: { concurrency: number }): Promise<BatchResult<TId>>`
  - `addAuditLog(db, orgId, action, actorUid, payload?): Promise<void>`
  - `callable<T>(handler: Handler<T>, options?: CallableOptions)`（`CallableOptions` は `firebase-functions/https` の型）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/shared/__tests__/runBatch.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/https'
import { runBatch } from '../runBatch'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('runBatch: 同時実行数を守り、成功は入力順で返す', async () => {
  let running = 0
  let maxRunning = 0
  const result = await runBatch([30, 10, 20, 5, 15], item => `id-${item}`, async (item) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await wait(item)
    running--
  }, { concurrency: 2 })

  assert.equal(maxRunning, 2)
  assert.deepEqual(result.succeeded, ['id-30', 'id-10', 'id-20', 'id-5', 'id-15'])
  assert.deepEqual(result.failed, [])
})

test('runBatch: 失敗した項目は理由付きで failed に入れ、他は続ける', async () => {
  const result = await runBatch(['a', 'b', 'c'], item => item, async (item) => {
    if (item === 'b') throw new HttpsError('unavailable', 'Google ビジネスプロフィールでエラーが発生しました: denied')
  })

  assert.deepEqual(result.succeeded, ['a', 'c'])
  assert.deepEqual(result.failed, [{ id: 'b', message: 'Google ビジネスプロフィールでエラーが発生しました: denied' }])
})

test('runBatch: Error 以外の例外は汎用メッセージ、空配列は空の結果', async () => {
  const result = await runBatch(['x'], item => item, async () => { throw 'boom' })
  assert.deepEqual(result.failed, [{ id: 'x', message: '処理に失敗しました。' }])
  assert.deepEqual(await runBatch([], item => item, async () => {}), { succeeded: [], failed: [] })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../runBatch'`）

- [ ] **Step 3: 実装する**

`functions/src/shared/runBatch.ts`:

```ts
// 一括処理（口コミの一括返信・複数店舗の同期など）。並列数を制限し、部分失敗は結果で返す。

export interface BatchResult<TId> {
  /** 入力順 */
  succeeded: TId[]
  failed: { id: TId; message: string }[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '処理に失敗しました。'
}

export async function runBatch<TItem, TId>(
  items: TItem[],
  idOf: (item: TItem) => TId,
  worker: (item: TItem) => Promise<void>,
  options: { concurrency: number } = { concurrency: 3 },
): Promise<BatchResult<TId>> {
  const outcomes: ({ ok: true } | { ok: false; message: string })[] = new Array(items.length)
  let next = 0
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++
      try {
        await worker(items[index]!)
        outcomes[index] = { ok: true }
      }
      catch (error) {
        outcomes[index] = { ok: false, message: messageOf(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, lane))

  const result: BatchResult<TId> = { succeeded: [], failed: [] }
  items.forEach((item, index) => {
    const outcome = outcomes[index]!
    if (outcome.ok) result.succeeded.push(idOf(item))
    else result.failed.push({ id: idOf(item), message: outcome.message })
  })
  return result
}
```

`functions/src/shared/audit.ts` の末尾に追加する。

```ts
/** トランザクションを使わない処理（GBP への書き込みなど）の監査ログ */
export async function addAuditLog(
  db: Firestore,
  orgId: string,
  action: string,
  actorUid: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.collection(`organizations/${orgId}/auditLogs`).add({ action, actorUid, payload, createdAt: FieldValue.serverTimestamp() })
}
```

`functions/src/shared/callable.ts` を次にする。

```ts
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { onCall, type CallableOptions } from 'firebase-functions/https'
import { requireCaller, type Caller } from './auth'

export type Handler<T> = (db: Firestore, caller: Caller, data: unknown) => Promise<T>

/** ログイン必須の callable。長い処理は options で timeoutSeconds を指定する */
export function callable<T>(handler: Handler<T>, options: CallableOptions = {}) {
  return onCall(options, request => handler(getFirestore(), requireCaller(request), request.data))
}

/** ログイン不要の callable（招待の確認など） */
export function publicCallable<T>(handler: (db: Firestore, data: unknown) => Promise<T>) {
  return onCall(request => handler(getFirestore(), request.data))
}
```

- [ ] **Step 4: テストとビルドを確認する**

Run: `cd functions && npm test && npm run build`
Expected: PASS（49 件 + runBatch 3 件 = 52 件）、ビルド成功

---

### Task 2: プロフィールの変換と検証（純粋関数）

**Files:**
- Create: `functions/src/gbp/profileMapping.ts`
- Modify: `functions/src/stores/stores.ts`（`formatAddress` を `profileMapping` から使う）
- Test: `functions/src/gbp/__tests__/profileMapping.test.ts`

**Interfaces:**
- Consumes: 計画 1 の `GbpLocation` / `GbpLocationPatch` / `GbpTimeOfDay` / `GbpDayOfWeek` / `GbpPostalAddress`、計画 2 の `fail`
- Produces:
  - `DAYS_OF_WEEK: readonly GbpDayOfWeek[]`
  - `interface RegularHoursPeriod { openDay: GbpDayOfWeek; openTime: string; closeDay: GbpDayOfWeek; closeTime: string }`
  - `interface SpecialHoursPeriod { date: string; isClosed: boolean; openTime: string | null; closeTime: string | null }`
  - `interface ProfileFields { title; address; categories: string[]; description; primaryPhone; websiteUri; regularHours: RegularHoursPeriod[]; specialHours: SpecialHoursPeriod[] }`
  - `formatTime(time?: GbpTimeOfDay): string`（`'HH:mm'`）/ `parseTime(value: unknown, label: string): GbpTimeOfDay`
  - `formatAddress(address?: GbpPostalAddress): string`
  - `toProfileFields(location: GbpLocation): ProfileFields`
  - `toLocationPatch(input: unknown): { patch: GbpLocationPatch; updateMask: string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/gbp/__tests__/profileMapping.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime, parseTime, toLocationPatch, toProfileFields } from '../profileMapping'

const invalid = { code: 'invalid-argument' }

test('formatTime / parseTime: 00:00（省略）と 24:00 を相互変換する', () => {
  assert.equal(formatTime({}), '00:00')
  assert.equal(formatTime(undefined), '00:00')
  assert.equal(formatTime({ hours: 9, minutes: 5 }), '09:05')
  assert.equal(formatTime({ hours: 24 }), '24:00')
  assert.deepEqual(parseTime('09:30', '開店'), { hours: 9, minutes: 30 })
  assert.deepEqual(parseTime('24:00', '閉店'), { hours: 24, minutes: 0 })
  for (const value of ['9:30', '24:30', '25:00', '12:60', '', null]) assert.throws(() => parseTime(value, '開店'), invalid)
})

test('toProfileFields: GBP のロケーションを画面用の形にする', () => {
  const fields = toProfileFields({
    name: 'locations/1',
    title: '渋谷店',
    phoneNumbers: { primaryPhone: '03-1234-5678' },
    categories: { primaryCategory: { name: 'c/1', displayName: '定食屋' }, additionalCategories: [{ name: 'c/2', displayName: '和食店' }] },
    storefrontAddress: { administrativeArea: '東京都', locality: '渋谷区', addressLines: ['道玄坂1-1'] },
    websiteUri: 'https://example.com',
    profile: { description: '説明' },
    regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 11 }, closeDay: 'MONDAY', closeTime: { hours: 22 } }] },
    specialHours: { specialHourPeriods: [
      { startDate: { year: 2026, month: 12, day: 31 }, closed: true },
      { startDate: { year: 2027, month: 1, day: 2 }, openTime: { hours: 12 }, closeTime: { hours: 18 } },
    ] },
  })

  assert.deepEqual(fields, {
    title: '渋谷店',
    address: '東京都渋谷区道玄坂1-1',
    categories: ['定食屋', '和食店'],
    description: '説明',
    primaryPhone: '03-1234-5678',
    websiteUri: 'https://example.com',
    regularHours: [{ openDay: 'MONDAY', openTime: '11:00', closeDay: 'MONDAY', closeTime: '22:00' }],
    specialHours: [
      { date: '2026-12-31', isClosed: true, openTime: null, closeTime: null },
      { date: '2027-01-02', isClosed: false, openTime: '12:00', closeTime: '18:00' },
    ],
  })
})

test('toProfileFields: 項目が無いロケーションは空で埋める', () => {
  const fields = toProfileFields({ name: 'locations/1' })
  assert.deepEqual(fields, { title: '', address: '', categories: [], description: '', primaryPhone: '', websiteUri: '', regularHours: [], specialHours: [] })
})

test('toLocationPatch: 渡した項目だけを updateMask にする', () => {
  const { patch, updateMask } = toLocationPatch({ description: ' 新しい説明 ', websiteUri: 'https://example.com/' })
  assert.deepEqual(updateMask, ['profile.description', 'websiteUri'])
  assert.deepEqual(patch, { profile: { description: '新しい説明' }, websiteUri: 'https://example.com/' })
})

test('toLocationPatch: 営業時間・特別営業時間を GBP の形にする', () => {
  const { patch, updateMask } = toLocationPatch({
    primaryPhone: '03-1111-2222',
    regularHours: [{ openDay: 'SATURDAY', openTime: '10:00', closeDay: 'SUNDAY', closeTime: '02:00' }],
    specialHours: [
      { date: '2026-12-31', isClosed: true, openTime: null, closeTime: null },
      { date: '2027-01-02', isClosed: false, openTime: '12:00', closeTime: '18:00' },
    ],
  })
  assert.deepEqual(updateMask, ['phoneNumbers.primaryPhone', 'regularHours', 'specialHours'])
  assert.deepEqual(patch.phoneNumbers, { primaryPhone: '03-1111-2222' })
  assert.deepEqual(patch.regularHours, { periods: [{ openDay: 'SATURDAY', openTime: { hours: 10, minutes: 0 }, closeDay: 'SUNDAY', closeTime: { hours: 2, minutes: 0 } }] })
  assert.deepEqual(patch.specialHours, { specialHourPeriods: [
    { startDate: { year: 2026, month: 12, day: 31 }, endDate: { year: 2026, month: 12, day: 31 }, closed: true },
    { startDate: { year: 2027, month: 1, day: 2 }, endDate: { year: 2027, month: 1, day: 2 }, openTime: { hours: 12, minutes: 0 }, closeTime: { hours: 18, minutes: 0 } },
  ] })
})

test('toLocationPatch: 入力不正は invalid-argument', () => {
  assert.throws(() => toLocationPatch({}), { code: 'invalid-argument', message: '変更する項目がありません。' })
  assert.throws(() => toLocationPatch({ description: 'あ'.repeat(751) }), { message: '説明は 750 文字以内にしてください。' })
  assert.throws(() => toLocationPatch({ websiteUri: 'example.com' }), { message: 'ウェブサイトは http:// または https:// で始まる URL を入力してください。' })
  assert.throws(() => toLocationPatch({ primaryPhone: '電話' }), { message: '電話番号の形式が正しくありません。' })
  assert.throws(() => toLocationPatch({ regularHours: [{ openDay: 'MON', openTime: '10:00', closeDay: 'MON', closeTime: '20:00' }] }), invalid)
  assert.throws(() => toLocationPatch({ specialHours: [{ date: '2026-02-30', isClosed: true }] }), { message: '特別営業時間の日付が正しくありません。' })
  assert.throws(() => toLocationPatch({ specialHours: [{ date: '2026-12-30', isClosed: false, openTime: null, closeTime: '18:00' }] }), invalid)
})

test('toLocationPatch: 空文字の電話番号・ウェブサイトは削除として送る', () => {
  const { patch, updateMask } = toLocationPatch({ primaryPhone: '', websiteUri: '' })
  assert.deepEqual(updateMask, ['phoneNumbers.primaryPhone', 'websiteUri'])
  assert.deepEqual(patch, { phoneNumbers: { primaryPhone: '' }, websiteUri: '' })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npm test`
Expected: FAIL（`Cannot find module '../profileMapping'`）

- [ ] **Step 3: 実装する**

`functions/src/gbp/profileMapping.ts`:

```ts
import { fail } from '../shared/errors'
import type { GbpDate, GbpDayOfWeek, GbpLocation, GbpLocationPatch, GbpPostalAddress, GbpSpecialHourPeriod, GbpTimeOfDay, GbpTimePeriod } from '../shared/gbp'
import { asObject } from '../shared/validation'

// GBP のロケーション ⇔ 画面で扱うプロフィールの変換。時刻は 'HH:mm'、日付は 'YYYY-MM-DD'。

export const DAYS_OF_WEEK: readonly GbpDayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const DESCRIPTION_MAX = 750
const TIME_PATTERN = /^(\d{2}):(\d{2})$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const PHONE_PATTERN = /^[0-9+\-() ]{1,30}$/

export interface RegularHoursPeriod {
  openDay: GbpDayOfWeek
  openTime: string
  closeDay: GbpDayOfWeek
  closeTime: string
}

export interface SpecialHoursPeriod {
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

export interface ProfileFields {
  title: string
  address: string
  categories: string[]
  description: string
  primaryPhone: string
  websiteUri: string
  regularHours: RegularHoursPeriod[]
  specialHours: SpecialHoursPeriod[]
}

const pad = (value: number) => String(value).padStart(2, '0')

/** GBP は 00:00 を {} で返すことがある */
export function formatTime(time?: GbpTimeOfDay): string {
  return `${pad(time?.hours ?? 0)}:${pad(time?.minutes ?? 0)}`
}

export function parseTime(value: unknown, label: string): GbpTimeOfDay {
  const match = typeof value === 'string' ? TIME_PATTERN.exec(value) : null
  const hours = Number(match?.[1])
  const minutes = Number(match?.[2])
  const isValid = match !== null && minutes < 60 && (hours < 24 || (hours === 24 && minutes === 0))
  if (!isValid) fail('invalid-argument', `${label}の時刻は 00:00〜24:00 の形式で入力してください。`)
  return { hours, minutes }
}

function formatDate(date: GbpDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

function parseDate(value: unknown): GbpDate {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const isValid = match !== null && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  if (!isValid) fail('invalid-argument', '特別営業時間の日付が正しくありません。')
  return { year, month, day }
}

export function formatAddress(address?: GbpPostalAddress): string {
  if (!address) return ''
  return [address.administrativeArea, address.locality, ...(address.addressLines ?? [])].filter(Boolean).join('')
}

export function toProfileFields(location: GbpLocation): ProfileFields {
  const categories = location.categories
  return {
    title: location.title ?? '',
    address: formatAddress(location.storefrontAddress),
    categories: [categories?.primaryCategory, ...(categories?.additionalCategories ?? [])]
      .map(category => category?.displayName)
      .filter((name): name is string => Boolean(name)),
    description: location.profile?.description ?? '',
    primaryPhone: location.phoneNumbers?.primaryPhone ?? '',
    websiteUri: location.websiteUri ?? '',
    regularHours: (location.regularHours?.periods ?? []).map(period => ({
      openDay: period.openDay,
      openTime: formatTime(period.openTime),
      closeDay: period.closeDay,
      closeTime: formatTime(period.closeTime),
    })),
    specialHours: (location.specialHours?.specialHourPeriods ?? []).map(period => ({
      date: formatDate(period.startDate),
      isClosed: period.closed === true,
      openTime: period.closed ? null : formatTime(period.openTime),
      closeTime: period.closed ? null : formatTime(period.closeTime),
    })),
  }
}

function requireArray(value: unknown, label: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) fail('invalid-argument', `${label}の値が正しくありません。`)
  return value
}

function requireDay(value: unknown): GbpDayOfWeek {
  if (typeof value !== 'string' || !DAYS_OF_WEEK.includes(value as GbpDayOfWeek)) fail('invalid-argument', '曜日の値が正しくありません。')
  return value as GbpDayOfWeek
}

function toRegularPeriod(value: unknown): GbpTimePeriod {
  const period = asObject(value)
  return {
    openDay: requireDay(period.openDay),
    openTime: parseTime(period.openTime, '開店'),
    closeDay: requireDay(period.closeDay),
    closeTime: parseTime(period.closeTime, '閉店'),
  }
}

function toSpecialPeriod(value: unknown): GbpSpecialHourPeriod {
  const period = asObject(value)
  const date = parseDate(period.date)
  if (period.isClosed === true) return { startDate: date, endDate: date, closed: true }
  return { startDate: date, endDate: date, openTime: parseTime(period.openTime, '開店'), closeTime: parseTime(period.closeTime, '閉店') }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') fail('invalid-argument', `${label}の値が正しくありません。`)
  return value.trim()
}

/** 画面から受け取った変更内容を検証し、GBP の PATCH 内容と updateMask にする */
export function toLocationPatch(input: unknown): { patch: GbpLocationPatch; updateMask: string[] } {
  const data = asObject(input)
  const patch: GbpLocationPatch = {}
  const updateMask: string[] = []

  if (data.description !== undefined) {
    const description = requireText(data.description, '説明')
    if (description.length > DESCRIPTION_MAX) fail('invalid-argument', `説明は ${DESCRIPTION_MAX} 文字以内にしてください。`)
    patch.profile = { description }
    updateMask.push('profile.description')
  }
  if (data.primaryPhone !== undefined) {
    const primaryPhone = requireText(data.primaryPhone, '電話番号')
    if (primaryPhone !== '' && !PHONE_PATTERN.test(primaryPhone)) fail('invalid-argument', '電話番号の形式が正しくありません。')
    patch.phoneNumbers = { primaryPhone }
    updateMask.push('phoneNumbers.primaryPhone')
  }
  if (data.websiteUri !== undefined) {
    const websiteUri = requireText(data.websiteUri, 'ウェブサイト')
    if (websiteUri !== '' && !/^https?:\/\/\S+$/.test(websiteUri)) {
      fail('invalid-argument', 'ウェブサイトは http:// または https:// で始まる URL を入力してください。')
    }
    patch.websiteUri = websiteUri
    updateMask.push('websiteUri')
  }
  if (data.regularHours !== undefined) {
    patch.regularHours = { periods: requireArray(data.regularHours, '営業時間', 50).map(toRegularPeriod) }
    updateMask.push('regularHours')
  }
  if (data.specialHours !== undefined) {
    patch.specialHours = { specialHourPeriods: requireArray(data.specialHours, '特別営業時間', 100).map(toSpecialPeriod) }
    updateMask.push('specialHours')
  }
  if (updateMask.length === 0) fail('invalid-argument', '変更する項目がありません。')
  return { patch, updateMask }
}
```

`functions/src/stores/stores.ts` のローカルな `formatAddress` を削除し、import に置き換える。

```ts
import { formatAddress } from '../gbp/profileMapping'
```

（`GbpPostalAddress` の import が不要になったら外す）

- [ ] **Step 4: テストを確認する**

Run: `cd functions && npm test`
Expected: PASS（52 件 + profileMapping 7 件 = 59 件）

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`（ルート）
Expected: 62 件 PASS（`formatAddress` の移動で店舗取込が壊れていない）

---

### Task 3: 偽の GBP サーバー・店舗の読み込み・プロフィールの同期と更新

**Files:**
- Modify: `functions/src/__tests__/fakeGoogle.ts`
- Create: `functions/src/gbp/storeAccess.ts`
- Create: `functions/src/gbp/profiles.ts`
- Test: `functions/src/gbp/__tests__/profiles.itest.ts`

**Interfaces:**
- Consumes: Task 1・2、計画 3 の `createGbpClientForConnection` / `withConnectionErrors` / `GoogleDeps`
- Produces:
  - `interface FakeGbpServer { locations: Record<string, GbpLocation>; reviews: Record<string, GbpReview[]>; failingNames: string[]; patches: { name: string; updateMask: string; body: unknown }[]; replies: { name: string; comment: string }[]; deletedReplies: string[] }` と `createFakeGbpServer(): FakeGbpServer`
  - `createFakeGoogle({ gbp?: FakeGbpServer; expiredRefreshTokens?: string[] })` を追加（`gbp` を渡したときは `expiredRefreshTokens` 以外のトークンを有効とする）
  - `interface GbpStore { id: string; name: string; connectionId: string; gbpAccountName: string; gbpLocationName: string }`
  - `loadGbpStores(db, orgId, member: MemberDoc | null, storeIds?: string[]): Promise<GbpStore[]>`（`member` が null はシステム処理。`storeIds` 省略時は有効な連携済み店舗すべて）
  - `createClientPool(db, orgId, deps): (connectionId: string) => Promise<GbpClient>`
  - `PROFILE_READ_MASK`
  - `updateGbpProfilesSyncFunc(db, caller, { orgId, storeIds? }, deps?): Promise<BatchResult<string>>`
  - `updateGbpProfileFunc(db, caller, { orgId, storeId, patch }, deps?): Promise<void>`
  - Firestore `gbpProfiles/{storeId}` = `{ orgId, storeId, ...ProfileFields, syncedAt }`

- [ ] **Step 1: 偽の GBP サーバーを追加する**

`functions/src/__tests__/fakeGoogle.ts` を次にする。

```ts
import { GbpAuthError, GbpClient } from '../shared/gbp'
import type { GbpAccount, GbpLocation, GbpReview } from '../shared/gbp'
import type { ExchangedTokens, GoogleDeps } from '../google/deps'

/** ロケーション取得・更新、口コミ一覧・返信を受け付ける偽の GBP */
export interface FakeGbpServer {
  /** キーは locations/{id} */
  locations: Record<string, GbpLocation>
  /** キーは accounts/{a}/locations/{l} */
  reviews: Record<string, GbpReview[]>
  /** この文字列を URL に含むリクエストは 403 にする */
  failingNames: string[]
  patches: { name: string; updateMask: string; body: unknown }[]
  replies: { name: string; comment: string }[]
  deletedReplies: string[]
}

export function createFakeGbpServer(): FakeGbpServer {
  return { locations: {}, reviews: {}, failingNames: [], patches: [], replies: [], deletedReplies: [] }
}

interface FakeGoogleOptions {
  tokens?: ExchangedTokens
  accounts?: GbpAccount[]
  /** refresh token ごとのロケーション一覧。数値は HTTP エラーのステータス。キーが無い refresh token は GbpAuthError にする */
  locationsByRefreshToken?: Record<string, Record<string, GbpLocation[] | number>>
  exchangeError?: Error
  gbp?: FakeGbpServer
  /** gbp を使うときに失効扱いにする refresh token */
  expiredRefreshTokens?: string[]
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const forbidden = () => json({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, 403)

function handleGbp(server: FakeGbpServer, url: URL, method: string, body: unknown): Response {
  if (server.failingNames.some(name => url.pathname.includes(name))) return forbidden()
  const location = url.pathname.match(/^\/v1\/(locations\/[^/]+)$/)?.[1]
  if (location) {
    const current = server.locations[location]
    if (!current) return json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404)
    if (method === 'PATCH') {
      server.patches.push({ name: location, updateMask: url.searchParams.get('updateMask') ?? '', body })
      server.locations[location] = { ...current, ...(body as object) }
    }
    return json(server.locations[location])
  }
  const reviewsOf = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+)\/reviews$/)?.[1]
  if (reviewsOf) return json({ reviews: server.reviews[reviewsOf] ?? [] })
  const reply = url.pathname.match(/^\/v4\/(accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+)\/reply$/)?.[1]
  if (reply && method === 'PUT') {
    const comment = (body as { comment: string }).comment
    server.replies.push({ name: reply, comment })
    return json({ comment, updateTime: '2026-10-07T00:00:00Z' })
  }
  if (reply && method === 'DELETE') {
    server.deletedReplies.push(reply)
    return new Response(null, { status: 200 })
  }
  throw new Error(`偽 GBP が扱わないリクエスト: ${method} ${url}`)
}

/** 外部（Google）を呼ばない偽の GoogleDeps。GbpClient は偽 fetch で応答を返す */
export function createFakeGoogle(options: FakeGoogleOptions = {}) {
  const calls = { exchange: 0, revoked: [] as string[], exchangeInputs: [] as unknown[] }
  const deps: GoogleDeps = {
    async exchangeCode(input) {
      calls.exchange++
      calls.exchangeInputs.push(input)
      if (options.exchangeError) throw options.exchangeError
      return options.tokens ?? { refreshToken: 'refresh-1', accessToken: 'access-1', googleEmail: 'Shop@Example.com' }
    },
    async listAccounts() {
      return options.accounts ?? [{ name: 'accounts/100', accountName: 'ハナミ食堂' }]
    },
    async revokeToken(token) {
      calls.revoked.push(token)
    },
    createGbpClient({ refreshToken }) {
      const byAccount = options.locationsByRefreshToken?.[refreshToken]
      const isExpired = options.gbp
        ? (options.expiredRefreshTokens ?? []).includes(refreshToken)
        : !byAccount
      return new GbpClient({
        getAccessToken: async () => {
          if (isExpired) throw new GbpAuthError('invalid_grant', 'Google の認証が無効です（invalid_grant）。再認証してください')
          return 'access'
        },
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input))
          const method = init?.method ?? 'GET'
          const listedAccount = url.pathname.match(/^\/v1\/(accounts\/[^/]+)\/locations$/)?.[1]
          if (listedAccount && byAccount) {
            const result = byAccount[listedAccount] ?? []
            return typeof result === 'number' ? (result === 403 ? forbidden() : json({}, result)) : json({ locations: result })
          }
          if (!options.gbp) return json({ locations: [] })
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
          return handleGbp(options.gbp, url, method, body)
        }) as typeof fetch,
        sleep: async () => {},
      })
    },
  }
  return { deps, calls }
}
```

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`（ルート）
Expected: 62 件 PASS（既存テストの挙動が変わっていない）

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/gbp/__tests__/profiles.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle, type FakeGbpServer } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from '../profiles'

const db = getTestDb()
const OWNER = caller('u-owner')
let gbp: FakeGbpServer

async function addStore(id: string, locationId: string, connectionId = 'c-1') {
  await db.doc(`organizations/org-a/stores/${id}`).set({
    orgId: 'org-a', name: `店舗 ${id}`, status: 'active', connectionId,
    gbpAccountName: 'accounts/1', gbpLocationName: `locations/${locationId}`,
  })
  gbp.locations[`locations/${locationId}`] = { name: `locations/${locationId}`, title: `店舗 ${id}`, profile: { description: `説明 ${id}` } }
}

beforeEach(async () => {
  await clearFirestore()
  gbp = createFakeGbpServer()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  for (const [id, token] of [['c-1', 'r1'], ['c-2', 'r2']]) {
    await db.doc(`organizations/org-a/googleConnections/${id}`).set({ orgId: 'org-a', status: 'active', googleEmail: `${id}@example.com`, gbpAccounts: [], lastError: null })
    await db.doc(`oauthTokens/${id}`).set({ orgId: 'org-a', secret: await encryptSecret(token) })
  }
  await addStore('st-1', '1')
  await addStore('st-2', '2')
  await db.doc('organizations/org-a/stores/st-manual').set({ orgId: 'org-a', name: '手動', status: 'active', connectionId: null })
})

test('profilesSync: 連携済みの全店舗のプロフィールを保存する（手動登録の店舗は対象外）', async () => {
  const result = await updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a' }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result, { succeeded: ['st-1', 'st-2'], failed: [] })
  const profile = (await db.doc('organizations/org-a/gbpProfiles/st-1').get()).data()!
  assert.equal(profile.storeId, 'st-1')
  assert.equal(profile.orgId, 'org-a')
  assert.equal(profile.description, '説明 st-1')
  assert.ok(profile.syncedAt)
})

test('profilesSync: staff は担当店舗のみ。担当外を指定すると permission-denied', async () => {
  const result = await updateGbpProfilesSyncFunc(db, caller('u-staff'), { orgId: 'org-a' }, createFakeGoogle({ gbp }).deps)
  assert.deepEqual(result.succeeded, ['st-1'])
  await assert.rejects(
    updateGbpProfilesSyncFunc(db, caller('u-staff'), { orgId: 'org-a', storeIds: ['st-2'] }, createFakeGoogle({ gbp }).deps),
    { code: 'permission-denied' },
  )
})

test('profilesSync: 1 店舗だけ 403・1 連携だけ失効でも、他の店舗は保存して失敗を理由付きで返す', async () => {
  await db.doc('organizations/org-a/stores/st-2').update({ connectionId: 'c-2' })
  gbp.failingNames.push('locations/1')
  const fake = createFakeGoogle({ gbp, expiredRefreshTokens: ['r2'] })
  await addStore('st-3', '3')

  const result = await updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a' }, fake.deps)

  assert.deepEqual(result.succeeded, ['st-3'])
  assert.deepEqual(result.failed.map(item => item.id), ['st-1', 'st-2'])
  assert.match(result.failed[0]!.message, /Google ビジネスプロフィールでエラー/)
  assert.match(result.failed[1]!.message, /再認証/)
  assert.equal((await db.doc('organizations/org-a/googleConnections/c-2').get()).get('status'), 'error')
})

test('profilesSync: 連携していない店舗を指定すると failed-precondition', async () => {
  await assert.rejects(
    updateGbpProfilesSyncFunc(db, OWNER, { orgId: 'org-a', storeIds: ['st-manual'] }, createFakeGoogle({ gbp }).deps),
    { code: 'failed-precondition', message: '店舗「手動」は Google ビジネスプロフィールと連携していません。' },
  )
})

test('updateGbpProfile: 変更項目だけを updateMask で送り、最新の内容を保存する', async () => {
  await updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: { description: '新しい説明', websiteUri: 'https://example.com' } }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(gbp.patches.map(item => [item.name, item.updateMask]), [['locations/1', 'profile.description,websiteUri']])
  const profile = (await db.doc('organizations/org-a/gbpProfiles/st-1').get()).data()!
  assert.equal(profile.description, '新しい説明')
  assert.equal(profile.websiteUri, 'https://example.com')
  const logs = await db.collection('organizations/org-a/auditLogs').where('action', '==', 'gbpProfile.update').get()
  assert.equal(logs.size, 1)
})

test('updateGbpProfile: staff は不可・入力不正は GBP を呼ばない', async () => {
  const fake = createFakeGoogle({ gbp })
  await assert.rejects(updateGbpProfileFunc(db, caller('u-staff'), { orgId: 'org-a', storeId: 'st-1', patch: { description: 'x' } }, fake.deps), { code: 'permission-denied' })
  await assert.rejects(updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: {} }, fake.deps), { code: 'invalid-argument' })
  assert.equal(gbp.patches.length, 0)
})

test('updateGbpProfile: GBP が拒否したら unavailable で理由を返す', async () => {
  gbp.failingNames.push('locations/1')
  await assert.rejects(
    updateGbpProfileFunc(db, OWNER, { orgId: 'org-a', storeId: 'st-1', patch: { description: 'x' } }, createFakeGoogle({ gbp }).deps),
    { code: 'unavailable' },
  )
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../profiles'`）

- [ ] **Step 4: 店舗の読み込みを実装する**

`functions/src/gbp/storeAccess.ts`:

```ts
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import type { GoogleDeps } from '../google/deps'
import { createGbpClientForConnection } from '../google/gbpClientFactory'
import { fail } from '../shared/errors'
import type { GbpClient } from '../shared/gbp'
import { requireStoreAccess, type MemberDoc } from '../shared/members'

// GBP と連携済みの店舗（connectionId・gbpAccountName・gbpLocationName を持つ有効な店舗）

export interface GbpStore {
  id: string
  name: string
  connectionId: string
  gbpAccountName: string
  gbpLocationName: string
}

function toGbpStore(id: string, data: DocumentData): GbpStore | null {
  if (data.status !== 'active' || !data.connectionId || !data.gbpAccountName || !data.gbpLocationName) return null
  return { id, name: data.name, connectionId: data.connectionId, gbpAccountName: data.gbpAccountName, gbpLocationName: data.gbpLocationName }
}

/**
 * 店舗を読み込む。storeIds を省略すると連携済みの全店舗（staff は担当店舗のみ）。
 * storeIds を指定した場合は、担当外・未連携があれば全体をエラーにする。member が null はシステム処理（自動同期）。
 */
export async function loadGbpStores(db: Firestore, orgId: string, member: MemberDoc | null, storeIds?: string[]): Promise<GbpStore[]> {
  if (!storeIds) {
    const snapshot = await db.collection(`organizations/${orgId}/stores`).where('status', '==', 'active').get()
    return snapshot.docs
      .map(doc => toGbpStore(doc.id, doc.data()))
      .filter((store): store is GbpStore => store !== null)
      .filter(store => !member || member.role !== 'staff' || member.storeIds.includes(store.id))
  }
  if (member) storeIds.forEach(id => requireStoreAccess(member, id))
  const snapshots = await Promise.all(storeIds.map(id => db.doc(`organizations/${orgId}/stores/${id}`).get()))
  return snapshots.map((snapshot) => {
    if (!snapshot.exists) fail('not-found', '店舗が見つかりません。')
    const store = toGbpStore(snapshot.id, snapshot.data()!)
    if (!store) fail('failed-precondition', `店舗「${snapshot.get('name')}」は Google ビジネスプロフィールと連携していません。`)
    return store
  })
}

/** 1 回の呼び出しの中で、連携ごとの GbpClient を使い回す */
export function createClientPool(db: Firestore, orgId: string, deps: GoogleDeps): (connectionId: string) => Promise<GbpClient> {
  const clients = new Map<string, Promise<GbpClient>>()
  return (connectionId) => {
    if (!clients.has(connectionId)) clients.set(connectionId, createGbpClientForConnection(db, orgId, connectionId, deps))
    return clients.get(connectionId)!
  }
}
```

- [ ] **Step 5: プロフィールを実装する**

`functions/src/gbp/profiles.ts`:

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { withConnectionErrors } from '../google/gbpClientFactory'
import { addAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import type { GbpLocation } from '../shared/gbp'
import { requireMember, requireOrg } from '../shared/members'
import { runBatch, type BatchResult } from '../shared/runBatch'
import { asObject, requireId, requireStringArray } from '../shared/validation'
import { toLocationPatch, toProfileFields } from './profileMapping'
import { createClientPool, loadGbpStores } from './storeAccess'

// プロフィールの同期・更新（店名・住所・カテゴリは表示のみ）

export const PROFILE_READ_MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile'

async function saveProfile(db: Firestore, orgId: string, storeId: string, location: GbpLocation): Promise<void> {
  await db.doc(`organizations/${orgId}/gbpProfiles/${storeId}`).set({
    orgId,
    storeId,
    ...toProfileFields(location),
    syncedAt: FieldValue.serverTimestamp(),
  })
}

function readStoreIds(value: unknown): string[] | undefined {
  return value === undefined ? undefined : requireStringArray(value, '店舗', 100)
}

export async function updateGbpProfilesSyncFunc(
  db: Firestore,
  caller: Caller,
  data: unknown,
  deps: GoogleDeps = defaultGoogleDeps,
): Promise<BatchResult<string>> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid)
  const stores = await loadGbpStores(db, orgId, member, readStoreIds(input.storeIds))
  const clientOf = createClientPool(db, orgId, deps)

  return runBatch(stores, store => store.id, store => withConnectionErrors(db, orgId, store.connectionId, async () => {
    const client = await clientOf(store.connectionId)
    await saveProfile(db, orgId, store.id, await client.getLocation(store.gbpLocationName, PROFILE_READ_MASK))
  }))
}

export async function updateGbpProfileFunc(db: Firestore, caller: Caller, data: unknown, deps: GoogleDeps = defaultGoogleDeps): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const storeId = requireId(input.storeId, '店舗 ID')
  const { patch, updateMask } = toLocationPatch(input.patch)
  await requireOrg(db, orgId)
  const member = await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const [store] = await loadGbpStores(db, orgId, member, [storeId])

  await withConnectionErrors(db, orgId, store!.connectionId, async () => {
    const client = await createClientPool(db, orgId, deps)(store!.connectionId)
    await client.updateLocation(store!.gbpLocationName, patch, updateMask)
    // PATCH の応答は更新した項目に限られることがあるため、取り直して保存する
    await saveProfile(db, orgId, storeId, await client.getLocation(store!.gbpLocationName, PROFILE_READ_MASK))
  })
  await addAuditLog(db, orgId, 'gbpProfile.update', caller.uid, { storeId, updateMask })
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（62 件 + profiles 7 件 = 69 件）

---

### Task 4: 口コミの同期・返信・返信削除

**Files:**
- Create: `functions/src/gbp/reviews.ts`
- Test: `functions/src/gbp/__tests__/reviews.itest.ts`

**Interfaces:**
- Consumes: Task 1・3、計画 1 の `toV4LocationPath` / `starRatingToNumber`
- Produces:
  - `MAX_REPLY_BYTES = 4096`、`MAX_BULK_REPLIES = 50`
  - `reviewDocId(reviewId: string): string`
  - `toReviewDoc(orgId, storeId, review: GbpReview): Record<string, unknown>`
  - `syncReviewsForStores(db, orgId, stores: GbpStore[], deps): Promise<BatchResult<string>>`
  - `updateGbpReviewsSyncFunc(db, caller, { orgId, storeIds? }, deps?): Promise<BatchResult<string>>`
  - `updateGbpReviewReplyFunc(db, caller, { orgId, items: { reviewId, comment }[] }, deps?): Promise<BatchResult<string>>`（`reviewId` は Firestore のドキュメント ID）
  - `deleteGbpReviewReplyFunc(db, caller, { orgId, reviewId }, deps?): Promise<void>`
  - Firestore `gbpReviews/{id}` = `{ orgId, storeId, reviewName, reviewerName, reviewerPhotoUrl, isAnonymous, starRating: number | null, comment: string | null, reviewCreatedAt, reviewUpdatedAt, reply: { comment, updatedAt } | null, hasReply, syncedAt }`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/gbp/__tests__/reviews.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle, type FakeGbpServer } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import type { GbpReview } from '../../shared/gbp'
import { encryptSecret } from '../../shared/secrets'
import { deleteGbpReviewReplyFunc, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from '../reviews'

const db = getTestDb()
const OWNER = caller('u-owner')
const PATH_1 = 'accounts/1/locations/1'
const PATH_2 = 'accounts/1/locations/2'
let gbp: FakeGbpServer

function review(path: string, id: string, overrides: Partial<GbpReview> = {}): GbpReview {
  return {
    name: `${path}/reviews/${id}`,
    reviewId: id,
    reviewer: { displayName: `投稿者 ${id}` },
    starRating: 'FOUR',
    comment: `本文 ${id}`,
    createTime: '2026-10-01T03:00:00Z',
    updateTime: '2026-10-01T03:00:00Z',
    ...overrides,
  }
}

beforeEach(async () => {
  await clearFirestore()
  gbp = createFakeGbpServer()
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ orgId: 'org-a', status: 'active', googleEmail: 'a@example.com', gbpAccounts: [], lastError: null })
  await db.doc('oauthTokens/c-1').set({ orgId: 'org-a', secret: await encryptSecret('r1') })
  for (const [id, location] of [['st-1', '1'], ['st-2', '2']]) {
    await db.doc(`organizations/org-a/stores/${id}`).set({ orgId: 'org-a', name: `店舗 ${id}`, status: 'active', connectionId: 'c-1', gbpAccountName: 'accounts/1', gbpLocationName: `locations/${location}` })
  }
  gbp.reviews[PATH_1] = [
    review(PATH_1, 'r-a', { reviewReply: { comment: 'ありがとうございます', updateTime: '2026-10-02T00:00:00Z' } }),
    review(PATH_1, 'r-b', { comment: undefined, starRating: 'FIVE', reviewer: { isAnonymous: true } }),
  ]
  gbp.reviews[PATH_2] = [review(PATH_2, 'r-c')]
})

const sync = (who = OWNER, data: object = { orgId: 'org-a' }) => updateGbpReviewsSyncFunc(db, who, data, createFakeGoogle({ gbp }).deps)
const reviewDoc = async (id: string) => (await db.doc(`organizations/org-a/gbpReviews/${id}`).get()).data()!

test('reviewsSync: 全店舗の口コミを保存する（返信・評価のみ・匿名）', async () => {
  const result = await sync()

  assert.deepEqual(result, { succeeded: ['st-1', 'st-2'], failed: [] })
  const replied = await reviewDoc('r-a')
  assert.equal(replied.storeId, 'st-1')
  assert.equal(replied.reviewName, `${PATH_1}/reviews/r-a`)
  assert.equal(replied.starRating, 4)
  assert.equal(replied.hasReply, true)
  assert.equal(replied.reply.comment, 'ありがとうございます')
  assert.equal(replied.reviewCreatedAt.toDate().toISOString(), '2026-10-01T03:00:00.000Z')
  const anonymous = await reviewDoc('r-b')
  assert.equal(anonymous.comment, null)
  assert.equal(anonymous.reviewerName, '匿名')
  assert.equal(anonymous.isAnonymous, true)
  assert.equal(anonymous.starRating, 5)
  assert.equal(anonymous.hasReply, false)
  assert.equal(anonymous.reply, null)
})

test('reviewsSync: staff は担当店舗の口コミだけを同期する', async () => {
  const result = await sync(caller('u-staff'))
  assert.deepEqual(result.succeeded, ['st-1'])
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-c').get()).exists, false)
})

test('reply: 個別・一括とも同じ関数で返信し、キャッシュを更新する', async () => {
  await sync()

  const result = await updateGbpReviewReplyFunc(db, OWNER, {
    orgId: 'org-a',
    items: [{ reviewId: 'r-b', comment: 'ご来店ありがとうございました' }, { reviewId: 'r-c', comment: 'またお待ちしております' }],
  }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result, { succeeded: ['r-b', 'r-c'], failed: [] })
  // 並列で送るため順序は問わない
  assert.deepEqual([...gbp.replies].sort((a, b) => a.name.localeCompare(b.name)), [
    { name: `${PATH_1}/reviews/r-b`, comment: 'ご来店ありがとうございました' },
    { name: `${PATH_2}/reviews/r-c`, comment: 'またお待ちしております' },
  ])
  const updated = await reviewDoc('r-b')
  assert.equal(updated.hasReply, true)
  assert.equal(updated.reply.comment, 'ご来店ありがとうございました')
})

test('reply: 一部だけ GBP が拒否しても他は返信し、失敗分を理由付きで返す', async () => {
  await sync()
  gbp.failingNames.push('reviews/r-b')

  const result = await updateGbpReviewReplyFunc(db, OWNER, {
    orgId: 'org-a',
    items: [{ reviewId: 'r-b', comment: 'a' }, { reviewId: 'r-c', comment: 'b' }],
  }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(result.succeeded, ['r-c'])
  assert.equal(result.failed[0]!.id, 'r-b')
  assert.match(result.failed[0]!.message, /Google ビジネスプロフィールでエラー/)
  assert.equal((await reviewDoc('r-b')).hasReply, false)
})

test('reply: 4096 バイトを超える返信・空の返信・51 件以上は GBP を呼ばずに invalid-argument', async () => {
  await sync()
  const fake = createFakeGoogle({ gbp })
  // 日本語 1 文字は 3 バイト。1366 文字 = 4098 バイト
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: 'あ'.repeat(1366) }] }, fake.deps),
    { code: 'invalid-argument', message: '返信は 4096 バイト以内にしてください（日本語は約 1,300 文字）。' },
  )
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: '  ' }] }, fake.deps),
    { code: 'invalid-argument' },
  )
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: Array.from({ length: 51 }, () => ({ reviewId: 'r-b', comment: 'a' })) }, fake.deps),
    { code: 'invalid-argument', message: '一度に返信できるのは 50 件までです。' },
  )
  await updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-b', comment: 'あ'.repeat(1365) }] }, fake.deps)
  assert.equal(gbp.replies.length, 1)
})

test('reply: staff の担当外が 1 件でも混ざれば全体を拒否し、GBP を呼ばない', async () => {
  await sync()
  await assert.rejects(
    updateGbpReviewReplyFunc(db, caller('u-staff'), {
      orgId: 'org-a',
      items: [{ reviewId: 'r-b', comment: 'a' }, { reviewId: 'r-c', comment: 'b' }],
    }, createFakeGoogle({ gbp }).deps),
    { code: 'permission-denied' },
  )
  assert.equal(gbp.replies.length, 0)
})

test('reply: 同期していない口コミは not-found', async () => {
  await assert.rejects(
    updateGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', items: [{ reviewId: 'r-x', comment: 'a' }] }, createFakeGoogle({ gbp }).deps),
    { code: 'not-found', message: '口コミが見つかりません。同期してからやり直してください。' },
  )
})

test('deleteReply: GBP の返信を削除し、キャッシュを未返信に戻す', async () => {
  await sync()
  await deleteGbpReviewReplyFunc(db, OWNER, { orgId: 'org-a', reviewId: 'r-a' }, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(gbp.deletedReplies, [`${PATH_1}/reviews/r-a`])
  const updated = await reviewDoc('r-a')
  assert.equal(updated.hasReply, false)
  assert.equal(updated.reply, null)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../reviews'`）

- [ ] **Step 3: 実装する**

`functions/src/gbp/reviews.ts`:

```ts
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { defaultGoogleDeps, type GoogleDeps } from '../google/deps'
import { withConnectionErrors } from '../google/gbpClientFactory'
import { addAuditLog } from '../shared/audit'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { starRatingToNumber, toV4LocationPath, type GbpClient, type GbpReview } from '../shared/gbp'
import { requireMember, requireOrg, requireStoreAccess } from '../shared/members'
import { runBatch, type BatchResult } from '../shared/runBatch'
import { asObject, requireId, requireString, requireStringArray } from '../shared/validation'
import { createClientPool, loadGbpStores, type GbpStore } from './storeAccess'

// 口コミの同期・返信（個別と一括は同じ関数）

export const MAX_REPLY_BYTES = 4096
export const MAX_BULK_REPLIES = 50
const WRITE_BATCH_SIZE = 400

/** GBP の reviewId を Firestore のドキュメント ID にする */
export function reviewDocId(reviewId: string): string {
  return reviewId.replace(/\//g, '_')
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

async function syncStoreReviews(db: Firestore, orgId: string, store: GbpStore, client: GbpClient): Promise<void> {
  const reviews = await client.listAllReviews(toV4LocationPath(store.gbpAccountName, store.gbpLocationName))
  for (let start = 0; start < reviews.length; start += WRITE_BATCH_SIZE) {
    const batch = db.batch()
    for (const review of reviews.slice(start, start + WRITE_BATCH_SIZE)) {
      batch.set(db.doc(`organizations/${orgId}/gbpReviews/${reviewDocId(review.reviewId)}`), {
        ...toReviewDoc(orgId, store.id, review),
        syncedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }
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
    return { reviewId: requireId(input.reviewId, '口コミ ID'), comment }
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
  const reviewId = requireId(input.reviewId, '口コミ ID')
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
```

> `requireId` は英数字・`-`・`_` だけを許す。GBP の reviewId がそれ以外の文字を含む場合に備え、同期時に `reviewDocId` で ID を作っている。実データで `requireId` に通らない ID が出たら、`reviewDocId` の置換対象を広げる（ledger に記録）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（69 件 + reviews 8 件 = 77 件）

---

### Task 5: 返信テンプレート・自動同期・公開・ルール・インデックス

**Files:**
- Create: `functions/src/gbp/templates.ts`
- Modify: `functions/src/gbp/reviews.ts`（`runScheduledReviewsSync` を追加）
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`、`firestore.indexes.json`
- Test: `functions/src/gbp/__tests__/templates.itest.ts`、`functions/src/__tests__/firestore.rules.itest.ts`（追記）

**Interfaces:**
- Consumes: Task 1〜4
- Produces:
  - `createReplyTemplateFunc(db, caller, { orgId, name, body }): Promise<{ id: string }>` / `updateReplyTemplateFunc(db, caller, { orgId, templateId, name, body }): Promise<void>` / `deleteReplyTemplateFunc(db, caller, { orgId, templateId }): Promise<void>`
  - Firestore `replyTemplates/{id}` = `{ orgId, name, body, createdAt, updatedAt }`
  - `runScheduledReviewsSync(db, deps?): Promise<{ orgCount: number; failedStoreCount: number }>`
  - callable: `updateGbpProfilesSync` / `updateGbpProfile` / `updateGbpReviewsSync` / `updateGbpReviewReply` / `deleteGbpReviewReply` / `createReplyTemplate` / `updateReplyTemplate` / `deleteReplyTemplate`、schedule: `scheduledGbpReviewsSync`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/gbp/__tests__/templates.itest.ts`:

```ts
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGbpServer, createFakeGoogle } from '../../__tests__/fakeGoogle'
import { updateGoogleOAuthClientFunc } from '../../google/oauthClient'
import { encryptSecret } from '../../shared/secrets'
import { runScheduledReviewsSync } from '../reviews'
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from '../templates'

const db = getTestDb()
const OWNER = caller('u-owner')

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }] })
})

test('replyTemplate: owner / admin が作成・更新・削除できる', async () => {
  const { id } = await createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: ' お礼 ', body: '{投稿者名}様、ありがとうございます。' })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).get('name'), 'お礼')

  await updateReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id, name: 'お礼（改）', body: '本文' })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).get('body'), '本文')

  await deleteReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: id })
  assert.equal((await db.doc(`organizations/org-a/replyTemplates/${id}`).get()).exists, false)
})

test('replyTemplate: staff は不可、空・長すぎる本文、存在しないテンプレートは拒否', async () => {
  await assert.rejects(createReplyTemplateFunc(db, caller('u-staff'), { orgId: 'org-a', name: 'x', body: 'y' }), { code: 'permission-denied' })
  await assert.rejects(createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'x', body: '' }), { code: 'invalid-argument' })
  await assert.rejects(createReplyTemplateFunc(db, OWNER, { orgId: 'org-a', name: 'x', body: 'a'.repeat(2001) }), { code: 'invalid-argument' })
  await assert.rejects(updateReplyTemplateFunc(db, OWNER, { orgId: 'org-a', templateId: 'none', name: 'x', body: 'y' }), { code: 'not-found' })
})

test('runScheduledReviewsSync: 連携中の組織の全店舗の口コミを同期する（停止中の組織は除く）', async () => {
  const gbp = createFakeGbpServer()
  gbp.reviews['accounts/1/locations/1'] = [{
    name: 'accounts/1/locations/1/reviews/r-1', reviewId: 'r-1', reviewer: { displayName: 'A' }, starRating: 'FIVE',
    createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z',
  }]
  await seedOrg(db, { orgId: 'org-stop', status: 'suspended', members: [{ uid: 'u-x', role: 'owner' }] })
  await updateGoogleOAuthClientFunc(db, OWNER, { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  for (const orgId of ['org-a', 'org-stop']) {
    await db.doc(`organizations/${orgId}/googleConnections/c-${orgId}`).set({ orgId, status: 'active', googleEmail: 'a@example.com', gbpAccounts: [], lastError: null })
    await db.doc(`oauthTokens/c-${orgId}`).set({ orgId, secret: await encryptSecret('r1') })
    await db.doc(`organizations/${orgId}/stores/st-1`).set({ orgId, name: '本店', status: 'active', connectionId: `c-${orgId}`, gbpAccountName: 'accounts/1', gbpLocationName: 'locations/1' })
  }

  const summary = await runScheduledReviewsSync(db, createFakeGoogle({ gbp }).deps)

  assert.deepEqual(summary, { orgCount: 1, failedStoreCount: 0 })
  assert.equal((await db.doc('organizations/org-a/gbpReviews/r-1').get()).get('starRating'), 5)
  assert.equal((await db.doc('organizations/org-stop/gbpReviews/r-1').get()).exists, false)
})
```

`functions/src/__tests__/firestore.rules.itest.ts` の `beforeEach` のシードに追加する（`withSecurityRulesDisabled` 内の最後）。

```ts
    await setDoc(doc(db, 'organizations/org-a/gbpProfiles/st-1'), { orgId: 'org-a', storeId: 'st-1', title: '渋谷店' })
    await setDoc(doc(db, 'organizations/org-a/gbpProfiles/st-2'), { orgId: 'org-a', storeId: 'st-2', title: '新宿店' })
    await setDoc(doc(db, 'organizations/org-a/gbpReviews/r-1'), { orgId: 'org-a', storeId: 'st-1', starRating: 5 })
    await setDoc(doc(db, 'organizations/org-a/gbpReviews/r-2'), { orgId: 'org-a', storeId: 'st-2', starRating: 3 })
    await setDoc(doc(db, 'organizations/org-a/replyTemplates/t-1'), { orgId: 'org-a', name: 'お礼', body: 'x' })
```

ファイル末尾にテストを追加する。

```ts
test('gbpProfiles / gbpReviews: owner は全店舗、staff は担当店舗だけ（storeId in で絞り込めば一覧も可）', async () => {
  for (const path of ['organizations/org-a/gbpProfiles', 'organizations/org-a/gbpReviews']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/gbpReviews/r-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/gbpReviews/r-2')))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/gbpReviews/r-1'), { hasReply: true }))
})

test('replyTemplates: メンバーは読める、他組織と書き込みは不可', async () => {
  await assertSucceeds(getDocs(collection(as('u-staff'), 'organizations/org-a/replyTemplates')))
  await assertFails(getDocs(collection(as('u-other'), 'organizations/org-a/replyTemplates')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/replyTemplates/t-2'), { name: 'x' }))
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: FAIL（`Cannot find module '../templates'`、ルールの新規テスト）

- [ ] **Step 3: テンプレートと自動同期を実装する**

`functions/src/gbp/templates.ts`:

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember } from '../shared/members'
import { asObject, requireId, requireString } from '../shared/validation'

// 口コミ返信のテンプレート（差し込みはクライアントで展開する）

const NAME_MAX = 50
const BODY_MAX = 2000

function templatesOf(db: Firestore, orgId: string) {
  return db.collection(`organizations/${orgId}/replyTemplates`)
}

function readTemplate(input: Record<string, unknown>): { name: string; body: string } {
  return { name: requireString(input.name, 'テンプレート名', NAME_MAX), body: requireString(input.body, 'テンプレートの本文', BODY_MAX) }
}

export async function createReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<{ id: string }> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const template = readTemplate(input)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const ref = await templatesOf(db, orgId).add({ orgId, ...template, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  return { id: ref.id }
}

export async function updateReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const templateId = requireId(input.templateId, 'テンプレート ID')
  const template = readTemplate(input)
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  const ref = templatesOf(db, orgId).doc(templateId)
  if (!(await ref.get()).exists) fail('not-found', 'テンプレートが見つかりません。')
  await ref.update({ ...template, updatedAt: FieldValue.serverTimestamp() })
}

export async function deleteReplyTemplateFunc(db: Firestore, caller: Caller, data: unknown): Promise<void> {
  const input = asObject(data)
  const orgId = requireId(input.orgId, '組織 ID')
  const templateId = requireId(input.templateId, 'テンプレート ID')
  await requireMember(db, orgId, caller.uid, ['owner', 'admin'])
  await templatesOf(db, orgId).doc(templateId).delete()
}
```

`functions/src/gbp/reviews.ts` の末尾に追加する（import に `logger` を `firebase-functions` から追加）。

```ts
/** 毎日の自動同期。連携中の組織（利用停止中は除く）の全店舗の口コミを同期する */
export async function runScheduledReviewsSync(db: Firestore, deps: GoogleDeps = defaultGoogleDeps): Promise<{ orgCount: number; failedStoreCount: number }> {
  const connections = await db.collectionGroup('googleConnections').where('status', '==', 'active').get()
  const orgIds = [...new Set(connections.docs.map(doc => doc.get('orgId') as string).filter(Boolean))]
  let orgCount = 0
  let failedStoreCount = 0
  for (const orgId of orgIds) {
    const org = await db.doc(`organizations/${orgId}`).get()
    if (org.get('status') !== 'active') continue
    orgCount++
    const result = await syncReviewsForStores(db, orgId, await loadGbpStores(db, orgId, null), deps)
    failedStoreCount += result.failed.length
    if (result.failed.length > 0) logger.warn('口コミの自動同期で失敗した店舗があります', { orgId, failed: result.failed })
  }
  return { orgCount, failedStoreCount }
}
```

- [ ] **Step 4: 公開する**

`functions/src/index.ts` の import に追加する。

```ts
import { onSchedule } from "firebase-functions/scheduler";
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from "./gbp/profiles";
import { deleteGbpReviewReplyFunc, runScheduledReviewsSync, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from "./gbp/reviews";
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from "./gbp/templates";
```

末尾に追加する。

```ts
// gbp/ … プロフィール・口コミ（docs/superpowers/specs/2026-10-07-gbp-integration-design.md 4.4）
const LONG_RUNNING = { timeoutSeconds: 300 };
export const updateGbpProfilesSync = callable((db, caller, data) => updateGbpProfilesSyncFunc(db, caller, data), LONG_RUNNING);
export const updateGbpProfile = callable((db, caller, data) => updateGbpProfileFunc(db, caller, data));
export const updateGbpReviewsSync = callable((db, caller, data) => updateGbpReviewsSyncFunc(db, caller, data), LONG_RUNNING);
export const updateGbpReviewReply = callable((db, caller, data) => updateGbpReviewReplyFunc(db, caller, data), LONG_RUNNING);
export const deleteGbpReviewReply = callable((db, caller, data) => deleteGbpReviewReplyFunc(db, caller, data));
export const createReplyTemplate = callable(createReplyTemplateFunc);
export const updateReplyTemplate = callable(updateReplyTemplateFunc);
export const deleteReplyTemplate = callable(deleteReplyTemplateFunc);
export const scheduledGbpReviewsSync = onSchedule(
  { schedule: "0 6 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540 },
  async () => {
    const summary = await runScheduledReviewsSync(getFirestore());
    logger.info("口コミの自動同期が完了しました", summary);
  },
);
```

- [ ] **Step 5: ルールとインデックスを追加する**

`firestore.rules` の `match /stores/{storeId}` の後に追加する。

```
      // GBP のキャッシュ（書き込みは Functions のみ）。staff は storeId in [担当店舗] で絞り込めば一覧も読める
      match /gbpProfiles/{storeId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /gbpReviews/{reviewId} {
        allow read: if isMember(orgId) && canReadStore(orgId, resource.data.storeId);
      }

      match /replyTemplates/{templateId} {
        allow read: if isMember(orgId);
      }
```

`firestore.indexes.json` の `indexes` と `fieldOverrides` に追加する。

```json
  "indexes": [
    {
      "collectionGroup": "gbpReviews",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "storeId", "order": "ASCENDING" },
        { "fieldPath": "reviewCreatedAt", "order": "DESCENDING" }
      ]
    }
  ],
```

```json
    {
      "collectionGroup": "googleConnections",
      "fieldPath": "status",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

- [ ] **Step 6: テストとビルドを確認する**

Run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`
Expected: PASS（77 件 + templates 3 件 + rules 2 件 = 82 件）

ルールの `storeId in` クエリが拒否された場合は、クライアント側の購読を「担当店舗ごとに `where('storeId', '==', id)`」に分ける（Task 8 に反映し、ledger に記録）。

Run: `cd functions && npm run build && npm test`
Expected: ビルド成功、単体 59 件 PASS

---

### Task 6: クライアントの型・モックデータ・モック関数・変換

**Files:**
- Modify: `app/types/domain.ts`
- Modify: `app/utils/mock/seed.ts`（`MockDb` と `createSeed`）
- Create: `app/utils/mock/gbpSeed.ts`
- Create: `app/utils/mock/functions/gbp.ts`
- Modify: `app/utils/firebase/emptyDb.ts`、`app/utils/firebase/converters.ts`

**Interfaces:**
- Produces:
  - 型 `GbpDayOfWeek` / `GbpRegularHoursPeriod` / `GbpSpecialHoursPeriod` / `GbpProfile` / `GbpProfilePatch` / `GbpReview` / `ReplyTemplate` / `BatchResult`
  - `MockDb` に `gbpProfiles` / `gbpReviews` / `replyTemplates`
  - `createGbpSeed(stores: Store[], now: Date): { gbpProfiles; gbpReviews; replyTemplates }`
  - モック関数: `updateGbpProfilesSyncFunc(db, uid, orgId, storeIds?)` / `updateGbpProfileFunc(db, uid, orgId, storeId, patch)` / `updateGbpReviewsSyncFunc(db, uid, orgId, storeIds?)` / `updateGbpReviewReplyFunc(db, uid, orgId, items)` / `deleteGbpReviewReplyFunc(db, uid, orgId, reviewId)` / `createReplyTemplateFunc(db, uid, orgId, input)` / `updateReplyTemplateFunc(db, uid, orgId, templateId, input)` / `deleteReplyTemplateFunc(db, uid, orgId, templateId)`
  - 変換: `toGbpProfile(data)` / `toGbpReview(id, data)` / `toReplyTemplate(id, data)`

- [ ] **Step 1: 型を追加する**

`app/types/domain.ts` の末尾に追加する。

```ts
export type GbpDayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** 時刻は 'HH:mm'（閉店 24:00 を含む） */
export interface GbpRegularHoursPeriod {
  openDay: GbpDayOfWeek
  openTime: string
  closeDay: GbpDayOfWeek
  closeTime: string
}

export interface GbpSpecialHoursPeriod {
  /** 'YYYY-MM-DD' */
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

/** GBP のプロフィールのキャッシュ（店名・住所・カテゴリは表示のみ） */
export interface GbpProfile {
  orgId: string
  storeId: string
  title: string
  address: string
  categories: string[]
  description: string
  primaryPhone: string
  websiteUri: string
  regularHours: GbpRegularHoursPeriod[]
  specialHours: GbpSpecialHoursPeriod[]
  syncedAt: string
}

/** プロフィールの編集内容。変更した項目だけを持つ */
export type GbpProfilePatch = Partial<Pick<GbpProfile, 'description' | 'primaryPhone' | 'websiteUri' | 'regularHours' | 'specialHours'>>

export interface GbpReview {
  id: string
  orgId: string
  storeId: string
  reviewName: string
  reviewerName: string
  reviewerPhotoUrl: string | null
  isAnonymous: boolean
  /** 1〜5。不明は null */
  starRating: number | null
  /** 評価だけの口コミは null */
  comment: string | null
  reviewCreatedAt: string
  reviewUpdatedAt: string
  reply: { comment: string; updatedAt: string } | null
  hasReply: boolean
}

export interface ReplyTemplate {
  id: string
  orgId: string
  name: string
  body: string
  createdAt: string
}

/** 一括処理の結果（部分失敗を含む） */
export interface BatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}
```

- [ ] **Step 2: モックのシードを作る**

`app/utils/mock/gbpSeed.ts`:

```ts
import type { GbpProfile, GbpReview, ReplyTemplate, Store } from '~/types/domain'
import { createRandom, pick, randomInt } from './random'

// GBP のプロフィール・口コミ・返信テンプレートの仮データ（シード付き乱数で毎回同じ内容）

const REVIEWERS = ['山田 花子', '佐々木 健', 'T. Suzuki', '高橋 美穂', '中村 翔', '小川 由美', 'K. Ito', '森 大樹']
const GOOD_COMMENTS = [
  'ランチで利用しました。味噌汁が絶品で、また来たいです。',
  '店員さんの対応がとても丁寧でした。',
  '落ち着いた雰囲気で、ゆっくり過ごせました。',
  '提供が早くて、昼休みでも安心して使えます。',
]
const BAD_COMMENTS = ['少し待ち時間が長かったです。', '量がもう少し多いと嬉しいです。']
const REPLIES = ['ご来店ありがとうございました。またのお越しをお待ちしております。', '貴重なご意見ありがとうございます。改善に努めます。']

export function createGbpSeed(stores: Store[], now: Date): { gbpProfiles: GbpProfile[]; gbpReviews: GbpReview[]; replyTemplates: ReplyTemplate[] } {
  const random = createRandom(20261007)
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString()
  const linked = stores.filter(store => store.gbpLocationName)

  const gbpProfiles: GbpProfile[] = linked.map(store => ({
    orgId: store.orgId,
    storeId: store.id,
    title: store.name,
    address: store.address,
    categories: store.orgId === 'org-komorebi' ? ['カフェ'] : ['定食屋', '和食店'],
    description: `${store.name}の公式プロフィールです。季節の食材を使ったメニューをご用意しています。`,
    primaryPhone: `03-${randomInt(random, 1000, 9999)}-${randomInt(random, 1000, 9999)}`,
    websiteUri: 'https://example.com/',
    regularHours: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const).map(day => ({
      openDay: day, openTime: '11:00', closeDay: day, closeTime: day === 'SATURDAY' ? '23:00' : '22:00',
    })),
    specialHours: [{ date: `${now.getFullYear()}-12-31`, isClosed: true, openTime: null, closeTime: null }],
    syncedAt: daysAgo(1),
  }))

  const gbpReviews: GbpReview[] = linked.flatMap(store => Array.from({ length: randomInt(random, 6, 12) }, (_, index) => {
    const starRating = pick(random, [5, 5, 5, 4, 4, 3, 2])
    const isAnonymous = random() < 0.1
    const hasComment = random() > 0.15
    const hasReply = random() < 0.5
    const created = daysAgo(index * 3 + randomInt(random, 0, 2))
    return {
      id: `rv-${store.id}-${index + 1}`,
      orgId: store.orgId,
      storeId: store.id,
      reviewName: `${store.gbpLocationName}/reviews/rv-${index + 1}`,
      reviewerName: isAnonymous ? '匿名' : pick(random, REVIEWERS),
      reviewerPhotoUrl: null,
      isAnonymous,
      starRating,
      comment: hasComment ? pick(random, starRating >= 4 ? GOOD_COMMENTS : BAD_COMMENTS) : null,
      reviewCreatedAt: created,
      reviewUpdatedAt: created,
      reply: hasReply ? { comment: pick(random, REPLIES), updatedAt: created } : null,
      hasReply,
    }
  }))

  const orgIds = [...new Set(linked.map(store => store.orgId))]
  const replyTemplates: ReplyTemplate[] = orgIds.flatMap(orgId => [
    { id: `tpl-${orgId}-thanks`, orgId, name: 'お礼（高評価）', body: '{投稿者名}様\n{店舗名}をご利用いただきありがとうございました。またのお越しを心よりお待ちしております。', createdAt: daysAgo(30) },
    { id: `tpl-${orgId}-improve`, orgId, name: 'お詫び（改善）', body: '{投稿者名}様\n貴重なご意見ありがとうございます。{店舗名}一同、改善に努めてまいります。', createdAt: daysAgo(30) },
  ])

  return { gbpProfiles, gbpReviews, replyTemplates }
}
```

`app/utils/mock/seed.ts` の `MockDb` に追加する。

```ts
  gbpProfiles: GbpProfile[]
  gbpReviews: GbpReview[]
  replyTemplates: ReplyTemplate[]
```

import の型に `GbpProfile, GbpReview, ReplyTemplate` を加え、`import { createGbpSeed } from './gbpSeed'` を追加する。`createSeed` の `return` の直前に追加し、`return` に `...gbp` を加える。

```ts
  const gbp = createGbpSeed(stores, now)
```

```ts
  return {
    users,
    // …既存の項目…
    usage,
    ...gbp,
  }
```

`app/utils/firebase/emptyDb.ts` の戻り値に追加する。

```ts
    gbpProfiles: [],
    gbpReviews: [],
    replyTemplates: [],
```

- [ ] **Step 3: モック関数を作る**

`app/utils/mock/functions/gbp.ts`:

```ts
import type { BatchResult, GbpProfilePatch, Store } from '~/types/domain'
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
  Object.assign(profile, structuredClone(patch), { syncedAt: new Date().toISOString() })
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
```

- [ ] **Step 4: 変換を追加する**

`app/utils/firebase/converters.ts` の import に `GbpProfile, GbpReview, ReplyTemplate` を加え、末尾に追加する。

```ts
export function toGbpProfile(data: DocumentData): GbpProfile {
  return {
    orgId: data.orgId,
    storeId: data.storeId,
    title: data.title ?? '',
    address: data.address ?? '',
    categories: data.categories ?? [],
    description: data.description ?? '',
    primaryPhone: data.primaryPhone ?? '',
    websiteUri: data.websiteUri ?? '',
    regularHours: data.regularHours ?? [],
    specialHours: data.specialHours ?? [],
    syncedAt: toIso(data.syncedAt),
  }
}

export function toGbpReview(id: string, data: DocumentData): GbpReview {
  return {
    id,
    orgId: data.orgId,
    storeId: data.storeId,
    reviewName: data.reviewName,
    reviewerName: data.reviewerName ?? '匿名',
    reviewerPhotoUrl: data.reviewerPhotoUrl ?? null,
    isAnonymous: data.isAnonymous === true,
    starRating: data.starRating ?? null,
    comment: data.comment ?? null,
    reviewCreatedAt: toIso(data.reviewCreatedAt),
    reviewUpdatedAt: toIso(data.reviewUpdatedAt),
    reply: data.reply ? { comment: data.reply.comment, updatedAt: toIso(data.reply.updatedAt) } : null,
    hasReply: data.hasReply === true,
  }
}

export function toReplyTemplate(id: string, data: DocumentData): ReplyTemplate {
  return { id, orgId: data.orgId, name: data.name, body: data.body, createdAt: toIso(data.createdAt) }
}
```

- [ ] **Step 5: 型チェックを確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

---

### Task 7: 購読・composable・差し込み・ナビ

**Files:**
- Modify: `app/composables/useFirestoreSync.ts`
- Create: `app/utils/replyTemplate.ts`
- Create: `app/composables/useGbpProfiles.ts`、`useGbpReviews.ts`、`useReplyTemplates.ts`
- Modify: `app/composables/useAdminNav.ts`

**Interfaces:**
- Consumes: Task 5 の callable 名、Task 6 の型・モック関数・変換
- Produces:
  - `REPLY_PLACEHOLDERS = ['{投稿者名}', '{店舗名}']`、`expandReplyTemplate(body, { reviewerName, storeName }): string`、`utf8ByteLength(text): number`、`MAX_REPLY_BYTES = 4096`
  - `useGbpProfiles(): { profiles: ComputedRef<{ store: Store; profile: GbpProfile | null }[]>; findProfile(storeId): ComputedRef<GbpProfile | null>; syncProfiles(storeIds?): Promise<BatchResult>; updateProfile(storeId, patch): Promise<void> }`
  - `useGbpReviews(): { reviews: ComputedRef<GbpReview[]>; syncReviews(storeIds?): Promise<BatchResult>; replyToReviews(items): Promise<BatchResult>; deleteReply(reviewId): Promise<void> }`
  - `useReplyTemplates(): { templates; createTemplate(input); updateTemplate(id, input); deleteTemplate(id) }`
  - ナビ: グループ「Google ビジネス」に プロフィール（`/profiles`・`map-pin`）・口コミ（`/reviews`・`star`）

- [ ] **Step 1: 購読を追加する**

`app/composables/useFirestoreSync.ts` の import に `limit` / `orderBy` を `firebase/firestore` から、`GbpProfile` / `GbpReview` / `ReplyTemplate` を型から、`toGbpProfile` / `toGbpReview` / `toReplyTemplate` を変換から追加する。

ミラーの定義に追加する。

```ts
  const profiles = new MirrorCollection<GbpProfile>(item => item.storeId, (items) => { db.value.gbpProfiles = items })
  const reviews = new MirrorCollection<GbpReview>(item => item.id, (items) => { db.value.gbpReviews = items })
  const templates = new MirrorCollection<ReplyTemplate>(item => item.id, (items) => { db.value.replyTemplates = items })
```

`resetAll` と `watchCurrentOrg` のミラー一覧に `profiles, reviews, templates` を加える（`for (const mirror of [...])` の配列）。

`watchStores` の後に、店舗で絞り込む購読の共通関数を追加する。

```ts
  /** 表示する口コミの上限（新しい順）。古い口コミは GBP の画面で確認する */
  const REVIEW_LIMIT = 500

  /** 店舗ごとのデータを購読する。staff は担当店舗だけを storeId in で絞り込む（ルールが担当外を拒否するため） */
  function watchStoreScoped<T>(
    orgId: string,
    member: Member,
    path: string,
    mirror: MirrorCollection<T>,
    toItem: (id: string, data: DocumentData) => T,
    constraints: QueryConstraint[] = [],
  ): void {
    const base = collection($db, `organizations/${orgId}/${path}`)
    if (member.role !== 'staff') {
      currentOrgSubscriptions.push(onSnapshot(query(base, ...constraints), (snapshot) => {
        mirror.set('current', snapshot.docs.map(item => toItem(item.id, item.data())))
      }))
      return
    }
    chunk(member.storeIds, IN_QUERY_LIMIT).forEach((storeIds, index) => {
      currentOrgSubscriptions.push(onSnapshot(query(base, where('storeId', 'in', storeIds), ...constraints), (snapshot) => {
        mirror.set(`current-${index}`, snapshot.docs.map(item => toItem(item.id, item.data())))
      }))
    })
  }
```

（`DocumentData` と `QueryConstraint` を `firebase/firestore` から type import する）

`watchCurrentOrg` の `watchStores(orgId, member)` の直後に追加する。

```ts
    watchStoreScoped(orgId, member, 'gbpProfiles', profiles, (_, data) => toGbpProfile(data))
    watchStoreScoped(orgId, member, 'gbpReviews', reviews, toGbpReview, [orderBy('reviewCreatedAt', 'desc'), limit(REVIEW_LIMIT)])
    currentOrgSubscriptions.push(onSnapshot(collection($db, `organizations/${orgId}/replyTemplates`), (snapshot) => {
      templates.set('current', snapshot.docs.map(item => toReplyTemplate(item.id, item.data())))
    }))
```

- [ ] **Step 2: 差し込みの utility を作る**

`app/utils/replyTemplate.ts`:

```ts
// 口コミ返信の差し込み。プレビューと送信内容を一致させるため、クライアントで展開してから送る。

export const REPLY_PLACEHOLDERS = ['{投稿者名}', '{店舗名}'] as const
export const MAX_REPLY_BYTES = 4096

export function expandReplyTemplate(body: string, values: { reviewerName: string; storeName: string }): string {
  return body.replaceAll('{投稿者名}', values.reviewerName).replaceAll('{店舗名}', values.storeName).trim()
}

/** GBP の返信上限はバイト数（UTF-8）で決まる */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
```

- [ ] **Step 3: composable を作る**

`app/composables/useGbpProfiles.ts`:

```ts
import type { BatchResult, GbpProfile, GbpProfilePatch, Store } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// GBP プロフィールの一覧・同期・編集

export function useGbpProfiles() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStores } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const profiles = computed<{ store: Store; profile: GbpProfile | null }[]>(() =>
    visibleStores.value.map(store => ({ store, profile: db.value.gbpProfiles.find(item => item.storeId === store.id) ?? null })))

  function findProfile(storeId: string) {
    return computed(() => db.value.gbpProfiles.find(item => item.storeId === storeId && item.orgId === orgId.value) ?? null)
  }

  async function syncProfiles(storeIds?: string[]): Promise<BatchResult> {
    if (!isMock) return callFunction($functions, 'updateGbpProfilesSync', { orgId: orgId.value, storeIds })
    await mockLatency(600)
    return updateGbpProfilesSyncFunc(db.value, user.value!.uid, orgId.value, storeIds)
  }

  async function updateProfile(storeId: string, patch: GbpProfilePatch): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateGbpProfile', { orgId: orgId.value, storeId, patch })
      return
    }
    await mockLatency(600)
    updateGbpProfileFunc(db.value, user.value!.uid, orgId.value, storeId, patch)
  }

  return { profiles, findProfile, syncProfiles, updateProfile }
}
```

`app/composables/useGbpReviews.ts`:

```ts
import type { BatchResult, GbpReview } from '~/types/domain'
import { callFunction } from '~/utils/firebase/callFunction'
import { deleteGbpReviewReplyFunc, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// 口コミの一覧・同期・返信（個別と一括は同じ関数）

export function useGbpReviews() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId, visibleStoreIds } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  /** 自分が扱える店舗の口コミ（新しい順） */
  const reviews = computed<GbpReview[]>(() =>
    db.value.gbpReviews
      .filter(review => review.orgId === orgId.value && visibleStoreIds.value.includes(review.storeId))
      .sort((a, b) => b.reviewCreatedAt.localeCompare(a.reviewCreatedAt)))

  async function syncReviews(storeIds?: string[]): Promise<BatchResult> {
    if (!isMock) return callFunction($functions, 'updateGbpReviewsSync', { orgId: orgId.value, storeIds })
    await mockLatency(600)
    return updateGbpReviewsSyncFunc(db.value, user.value!.uid, orgId.value, storeIds)
  }

  async function replyToReviews(items: { reviewId: string; comment: string }[]): Promise<BatchResult> {
    if (!isMock) return callFunction($functions, 'updateGbpReviewReply', { orgId: orgId.value, items })
    await mockLatency(600)
    return updateGbpReviewReplyFunc(db.value, user.value!.uid, orgId.value, items)
  }

  async function deleteReply(reviewId: string): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'deleteGbpReviewReply', { orgId: orgId.value, reviewId })
      return
    }
    await mockLatency()
    deleteGbpReviewReplyFunc(db.value, user.value!.uid, orgId.value, reviewId)
  }

  return { reviews, syncReviews, replyToReviews, deleteReply }
}
```

`app/composables/useReplyTemplates.ts`:

```ts
import { callFunction } from '~/utils/firebase/callFunction'
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from '~/utils/mock/functions/gbp'
import { mockLatency } from '~/utils/mock/functions/shared'

// 口コミ返信のテンプレート（owner / admin が管理し、メンバー全員が使える）

export function useReplyTemplates() {
  const isMock = useRuntimeConfig().public.useMock
  const db = useAppDb()
  const { user } = useAuth()
  const { orgId } = useCurrentOrg()
  const { $functions } = useNuxtApp()

  const templates = computed(() =>
    db.value.replyTemplates.filter(item => item.orgId === orgId.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))

  async function createTemplate(input: { name: string; body: string }): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'createReplyTemplate', { orgId: orgId.value, ...input })
      return
    }
    await mockLatency()
    createReplyTemplateFunc(db.value, user.value!.uid, orgId.value, input)
  }

  async function updateTemplate(templateId: string, input: { name: string; body: string }): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'updateReplyTemplate', { orgId: orgId.value, templateId, ...input })
      return
    }
    await mockLatency()
    updateReplyTemplateFunc(db.value, user.value!.uid, orgId.value, templateId, input)
  }

  async function deleteTemplate(templateId: string): Promise<void> {
    if (!isMock) {
      await callFunction($functions, 'deleteReplyTemplate', { orgId: orgId.value, templateId })
      return
    }
    await mockLatency()
    deleteReplyTemplateFunc(db.value, user.value!.uid, orgId.value, templateId)
  }

  return { templates, createTemplate, updateTemplate, deleteTemplate }
}
```

- [ ] **Step 4: ナビを追加する**

`app/composables/useAdminNav.ts`:

```ts
export type AdminNavIcon = 'home' | 'store' | 'survey' | 'ranking' | 'settings' | 'map-pin' | 'star'
```

```ts
const FIREBASE_READY_PATHS = ['/settings/organization', '/settings/members', '/settings/google', '/stores', '/profiles', '/reviews']
```

`NAV_GROUPS` の「メイン」と「設定」の間に追加する。

```ts
  {
    label: 'Google ビジネス',
    items: [
      { label: 'プロフィール', path: '/profiles', icon: 'map-pin' },
      { label: '口コミ', path: '/reviews', icon: 'star' },
    ],
  },
```

- [ ] **Step 5: 型チェックを確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

---

### Task 8: プロフィール画面（一覧・編集・営業時間の入力）

**Files:**
- Create: `app/utils/gbpLabels.ts`
- Create: `app/components/Gbp/Input/RegularHoursEditor.vue`、`SpecialHoursEditor.vue`
- Create: `app/pages/admin/[orgId]/profiles/index.vue`、`[storeId].vue`

**Interfaces:**
- Consumes: Task 7 の `useGbpProfiles`
- Produces:
  - `DAY_LABELS: Record<GbpDayOfWeek, string>`、`DAYS_OF_WEEK: GbpDayOfWeek[]`、`summarizeRegularHours(periods): string`
  - `<GbpInputRegularHoursEditor v-model="periods" :is-disabled />`、`<GbpInputSpecialHoursEditor v-model="periods" :is-disabled />`

- [ ] **Step 1: 表示用ラベルを作る**

`app/utils/gbpLabels.ts`:

```ts
import type { GbpDayOfWeek, GbpRegularHoursPeriod } from '~/types/domain'

export const DAYS_OF_WEEK: GbpDayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

export const DAY_LABELS: Record<GbpDayOfWeek, string> = {
  MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日',
}

/** 一覧用の短い要約（例: 月〜土 営業・日 定休） */
export function summarizeRegularHours(periods: GbpRegularHoursPeriod[]): string {
  if (periods.length === 0) return '未設定'
  const openDays = DAYS_OF_WEEK.filter(day => periods.some(period => period.openDay === day))
  const closedDays = DAYS_OF_WEEK.filter(day => !openDays.includes(day))
  const open = openDays.map(day => DAY_LABELS[day]).join('・')
  return closedDays.length === 0 ? `${open} 営業` : `${open} 営業 / ${closedDays.map(day => DAY_LABELS[day]).join('・')} 定休`
}
```

- [ ] **Step 2: 営業時間の入力部品を作る**

`app/components/Gbp/Input/RegularHoursEditor.vue`:

```vue
<script setup lang="ts">
import type { GbpRegularHoursPeriod } from '~/types/domain'

// 通常の営業時間。閉店が開店より前（深夜営業）のときは翌日の閉店として扱う

interface Props {
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { isDisabled: false })
const periods = defineModel<GbpRegularHoursPeriod[]>({ required: true })

const dayOptions = DAYS_OF_WEEK.map(day => ({ value: day, label: `${DAY_LABELS[day]}曜日` }))

function nextDay(day: GbpRegularHoursPeriod['openDay']): GbpRegularHoursPeriod['openDay'] {
  return DAYS_OF_WEEK[(DAYS_OF_WEEK.indexOf(day) + 1) % DAYS_OF_WEEK.length]!
}

function onChange(index: number, field: 'openDay' | 'openTime' | 'closeTime', value: string): void {
  const next = periods.value.map(period => ({ ...period }))
  const period = { ...next[index]!, [field]: value } as GbpRegularHoursPeriod
  period.closeDay = period.closeTime !== '24:00' && period.closeTime <= period.openTime ? nextDay(period.openDay) : period.openDay
  next[index] = period
  periods.value = next
}

function onAdd(): void {
  const usedDays = periods.value.map(period => period.openDay)
  const day = DAYS_OF_WEEK.find(item => !usedDays.includes(item)) ?? 'MONDAY'
  periods.value = [...periods.value, { openDay: day, openTime: '10:00', closeDay: day, closeTime: '20:00' }]
}

function onRemove(index: number): void {
  periods.value = periods.value.filter((_, position) => position !== index)
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="periods.length === 0" class="text-sm text-slate-500">営業時間が設定されていません。</p>
    <div v-for="(period, index) in periods" :key="index" class="flex flex-wrap items-end gap-2">
      <div class="w-28">
        <UiInputSelectField :model-value="period.openDay" label="曜日" :options="dayOptions" is-label-hidden :is-disabled="isDisabled" @update:model-value="onChange(index, 'openDay', $event)" />
      </div>
      <input
        type="time"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.openTime"
        :disabled="isDisabled"
        aria-label="開店"
        @change="onChange(index, 'openTime', ($event.target as HTMLInputElement).value)"
      >
      <span class="pb-2 text-sm text-slate-500">〜</span>
      <input
        type="time"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.closeTime === '24:00' ? '00:00' : period.closeTime"
        :disabled="isDisabled"
        aria-label="閉店"
        @change="onChange(index, 'closeTime', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="period.closeDay !== period.openDay" class="pb-2 text-xs text-slate-500">（翌日）</span>
      <UiCommonButton v-if="!isDisabled" variant="ghost" size="sm" icon="trash" :aria-label="`${DAY_LABELS[period.openDay]}曜日の営業時間を削除`" @click="onRemove(index)" />
    </div>
    <UiCommonButton v-if="!isDisabled" variant="secondary" size="sm" icon="plus" @click="onAdd">時間帯を追加</UiCommonButton>
  </div>
</template>
```

`app/components/Gbp/Input/SpecialHoursEditor.vue`:

```vue
<script setup lang="ts">
import type { GbpSpecialHoursPeriod } from '~/types/domain'

// 特別営業時間（祝日・年末年始など）。休業日か、その日の営業時間を指定する

interface Props {
  isDisabled?: boolean
}

withDefaults(defineProps<Props>(), { isDisabled: false })
const periods = defineModel<GbpSpecialHoursPeriod[]>({ required: true })

function onChange(index: number, patch: Partial<GbpSpecialHoursPeriod>): void {
  periods.value = periods.value.map((period, position) => {
    if (position !== index) return period
    const next = { ...period, ...patch }
    return next.isClosed
      ? { ...next, openTime: null, closeTime: null }
      : { ...next, openTime: next.openTime ?? '10:00', closeTime: next.closeTime ?? '18:00' }
  })
}

function onAdd(): void {
  periods.value = [...periods.value, { date: toDayKey(new Date()), isClosed: true, openTime: null, closeTime: null }]
}

function onRemove(index: number): void {
  periods.value = periods.value.filter((_, position) => position !== index)
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="periods.length === 0" class="text-sm text-slate-500">特別営業時間はありません。</p>
    <div v-for="(period, index) in periods" :key="index" class="flex flex-wrap items-center gap-2">
      <input
        type="date"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        :value="period.date"
        :disabled="isDisabled"
        aria-label="日付"
        @change="onChange(index, { date: ($event.target as HTMLInputElement).value })"
      >
      <label class="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" :checked="period.isClosed" :disabled="isDisabled" @change="onChange(index, { isClosed: ($event.target as HTMLInputElement).checked })">
        休業
      </label>
      <template v-if="!period.isClosed">
        <input
          type="time"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          :value="period.openTime ?? ''"
          :disabled="isDisabled"
          aria-label="開店"
          @change="onChange(index, { openTime: ($event.target as HTMLInputElement).value })"
        >
        <span class="text-sm text-slate-500">〜</span>
        <input
          type="time"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          :value="period.closeTime ?? ''"
          :disabled="isDisabled"
          aria-label="閉店"
          @change="onChange(index, { closeTime: ($event.target as HTMLInputElement).value })"
        >
      </template>
      <UiCommonButton v-if="!isDisabled" variant="ghost" size="sm" icon="trash" :aria-label="`${period.date} の特別営業時間を削除`" @click="onRemove(index)" />
    </div>
    <UiCommonButton v-if="!isDisabled" variant="secondary" size="sm" icon="plus" @click="onAdd">日付を追加</UiCommonButton>
  </div>
</template>
```

> `UiInputSelectField` の `@update:model-value` の値の型が `string` でない場合は、`GbpDayOfWeek` にキャストして渡す（`app/components/Ui/Input/SelectField.vue` のジェネリクスを確認する）。`toDayKey` は `app/utils/format.ts`（自動 import）。

- [ ] **Step 3: 一覧画面を作る**

`app/pages/admin/[orgId]/profiles/index.vue`:

```vue
<script setup lang="ts">
import type { BatchResult } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'プロフィール' })

// GBP プロフィールの一覧と同期

const { adminPath, storeName } = useCurrentOrg()
const { profiles, syncProfiles } = useGbpProfiles()
const { show } = useToast()
const { isPending, errorMessage, run } = useActionState()
const lastFailures = ref<BatchResult['failed']>([])

async function onSync(): Promise<void> {
  const result = await run(() => syncProfiles())
  if (!result) return
  lastFailures.value = result.failed
  show(result.failed.length === 0 ? `${result.succeeded.length} 店舗を同期しました` : `${result.failed.length} 店舗の同期に失敗しました`, result.failed.length === 0 ? 'success' : 'danger')
}
</script>

<template>
  <div>
    <UiCommonPageHeader title="プロフィール" description="Google ビジネスプロフィールの店舗情報を確認・編集します">
      <template #actions>
        <UiCommonButton icon="refresh" variant="secondary" :is-loading="isPending" @click="onSync">すべて同期</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert v-if="errorMessage" tone="danger" class="mb-4">{{ errorMessage }}</UiCommonAlert>
    <UiCommonAlert v-if="lastFailures.length > 0" tone="danger" title="同期できなかった店舗" class="mb-4">
      <ul class="list-disc pl-5">
        <li v-for="failure in lastFailures" :key="failure.id">{{ storeName(failure.id) }}: {{ failure.message }}</li>
      </ul>
    </UiCommonAlert>

    <p v-if="profiles.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
      店舗がありません。店舗画面から Google ビジネスプロフィールのロケーションを取り込んでください。
    </p>

    <ul v-else class="grid gap-3">
      <li v-for="{ store, profile } in profiles" :key="store.id" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1 space-y-1.5">
            <p class="font-semibold text-slate-900">{{ store.name }}</p>
            <template v-if="profile">
              <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                <span>電話 {{ profile.primaryPhone || '未設定' }}</span>
                <span class="break-all">サイト {{ profile.websiteUri || '未設定' }}</span>
                <span>{{ summarizeRegularHours(profile.regularHours) }}</span>
              </p>
              <p class="text-xs text-slate-400">最終同期 {{ formatDateTime(profile.syncedAt) }}</p>
            </template>
            <p v-else-if="store.gbpLocationName" class="text-sm text-slate-500">まだ同期していません。</p>
            <UiCommonBadge v-else tone="neutral">GBP 未連携</UiCommonBadge>
          </div>
          <UiCommonButton v-if="store.gbpLocationName" variant="secondary" size="sm" :to="adminPath(`/profiles/${store.id}`)">
            {{ profile ? '詳細・編集' : '開く' }}
          </UiCommonButton>
        </div>
      </li>
    </ul>
  </div>
</template>
```

> `useToast().show` の第 2 引数の型（`'success' | 'danger'` など）を `app/composables/useToast.ts` で確認し、合わせる。

- [ ] **Step 4: 詳細・編集画面を作る**

`app/pages/admin/[orgId]/profiles/[storeId].vue`:

```vue
<script setup lang="ts">
import type { GbpProfile, GbpProfilePatch } from '~/types/domain'

definePageMeta({ layout: 'admin' })

// GBP プロフィールの詳細・編集（編集は owner / admin）。変更した項目だけを送る

const route = useRoute()
const storeId = String(route.params.storeId)
const { adminPath, storeName, canManage, canAccessStore } = useCurrentOrg()
const { findProfile, syncProfiles, updateProfile } = useGbpProfiles()
const { show } = useToast()
const profile = findProfile(storeId)
useHead({ title: () => `${storeName(storeId)} のプロフィール` })

type EditableFields = Required<GbpProfilePatch>
const form = ref<EditableFields | null>(null)

function toForm(source: GbpProfile): EditableFields {
  return structuredClone({
    description: source.description,
    primaryPhone: source.primaryPhone,
    websiteUri: source.websiteUri,
    regularHours: source.regularHours,
    specialHours: source.specialHours,
  })
}

watch(profile, (value) => { if (value && !form.value) form.value = toForm(value) }, { immediate: true })

const changes = computed<GbpProfilePatch>(() => {
  if (!profile.value || !form.value) return {}
  const original = toForm(profile.value)
  return Object.fromEntries((Object.keys(form.value) as (keyof EditableFields)[])
    .filter(key => JSON.stringify(form.value![key]) !== JSON.stringify(original[key]))
    .map(key => [key, form.value![key]]))
})
const hasChanges = computed(() => Object.keys(changes.value).length > 0)

const syncState = useActionState()
const saveState = useActionState()

async function onSync(): Promise<void> {
  const result = await syncState.run(() => syncProfiles([storeId]))
  if (!result) return
  if (result.failed.length > 0) {
    syncState.errorMessage.value = result.failed[0]!.message
    return
  }
  if (profile.value) form.value = toForm(profile.value)
  show('Google から最新の内容を取得しました')
}

async function onSave(): Promise<void> {
  const isDone = await saveState.run(async () => {
    await updateProfile(storeId, changes.value)
    return true
  })
  if (!isDone) return
  if (profile.value) form.value = toForm(profile.value)
  show('Google ビジネスプロフィールを更新しました')
}

function onReset(): void {
  if (profile.value) form.value = toForm(profile.value)
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UiCommonPageHeader :title="storeName(storeId)" description="Google ビジネスプロフィール" :back-to="adminPath('/profiles')" back-label="プロフィール一覧">
      <template #actions>
        <UiCommonButton icon="refresh" variant="secondary" :is-loading="syncState.isPending.value" @click="onSync">同期</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <UiCommonAlert v-if="!canAccessStore(storeId)" tone="danger">担当外の店舗です。</UiCommonAlert>
    <UiCommonAlert v-if="syncState.errorMessage.value" tone="danger">{{ syncState.errorMessage.value }}</UiCommonAlert>

    <div v-if="!profile" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p class="text-sm text-slate-500">まだ同期していません。「同期」で Google から取得してください。</p>
    </div>

    <template v-else-if="form">
      <UiCommonCard title="基本情報">
        <dl class="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt class="text-slate-500">店名</dt>
          <dd class="text-slate-900">{{ profile.title }}</dd>
          <dt class="text-slate-500">住所</dt>
          <dd class="text-slate-900">{{ profile.address || '未設定' }}</dd>
          <dt class="text-slate-500">カテゴリ</dt>
          <dd class="text-slate-900">{{ profile.categories.join('、') || '未設定' }}</dd>
          <dt class="text-slate-500">最終同期</dt>
          <dd class="text-slate-900">{{ formatDateTime(profile.syncedAt) }}</dd>
        </dl>
        <p class="mt-3 text-xs text-slate-500">店名・住所・カテゴリの変更は Google の再確認が必要になることがあるため、Google ビジネスプロフィールの管理画面で行ってください。</p>
      </UiCommonCard>

      <UiCommonCard title="編集できる項目">
        <div class="space-y-5">
          <UiInputTextareaField v-model="form.description" label="ビジネスの説明" :rows="5" :maxlength="750" :hint="`${form.description.length} / 750 文字`" :is-disabled="!canManage" />
          <UiInputTextField v-model="form.primaryPhone" label="電話番号" placeholder="03-1234-5678" :is-disabled="!canManage" />
          <UiInputTextField v-model="form.websiteUri" label="ウェブサイト" type="url" placeholder="https://example.com" :is-disabled="!canManage" />
          <div class="space-y-2">
            <p class="text-sm font-medium text-slate-700">営業時間</p>
            <GbpInputRegularHoursEditor v-model="form.regularHours" :is-disabled="!canManage" />
          </div>
          <div class="space-y-2">
            <p class="text-sm font-medium text-slate-700">特別営業時間</p>
            <GbpInputSpecialHoursEditor v-model="form.specialHours" :is-disabled="!canManage" />
          </div>
        </div>
      </UiCommonCard>

      <UiCommonAlert v-if="saveState.errorMessage.value" tone="danger">{{ saveState.errorMessage.value }}</UiCommonAlert>
      <div v-if="canManage" class="flex justify-end gap-2">
        <UiCommonButton variant="secondary" :is-disabled="!hasChanges" @click="onReset">元に戻す</UiCommonButton>
        <UiCommonButton :is-loading="saveState.isPending.value" :is-disabled="!hasChanges" @click="onSave">Google に反映する</UiCommonButton>
      </div>
      <p v-else class="text-sm text-slate-500">プロフィールの編集はオーナーまたは管理者が行います。</p>
    </template>
  </div>
</template>
```

> `UiCommonPageHeader` の `actions` スロット名、`useHead` の関数形式（`title: () => ...`）が既存ページと合わない場合は、既存の `stores/[storeId].vue` の書き方に合わせる。

- [ ] **Step 5: 型チェックとモックの表示を確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

Run: `npm run dev`（モック）で法人オーナー → プロフィール一覧（3 店舗・電話・営業時間の要約）→ 渋谷店の詳細で説明と土曜の閉店時刻を変えて「Google に反映する」→ 一覧に戻って反映を確認。スタッフでは担当の渋谷店だけが表示され、編集欄が無効になっていること

---

### Task 9: 口コミ画面（一覧・個別返信・一括返信・テンプレート）

**Files:**
- Create: `app/components/Gbp/Reviews/StarRating.vue`、`ReplyForm.vue`、`ReviewCard.vue`、`BulkReplyModal.vue`、`TemplateManagerModal.vue`
- Create: `app/pages/admin/[orgId]/reviews/index.vue`

**Interfaces:**
- Consumes: Task 7 の `useGbpReviews` / `useReplyTemplates` / `expandReplyTemplate` / `utf8ByteLength` / `MAX_REPLY_BYTES`
- Produces: 画面のみ

- [ ] **Step 1: 星表示と返信フォームを作る**

`app/components/Gbp/Reviews/StarRating.vue`:

```vue
<script setup lang="ts">
interface Props {
  rating: number | null
}

defineProps<Props>()
</script>

<template>
  <span class="inline-flex items-center gap-0.5" :aria-label="rating ? `星 ${rating}` : '評価なし'">
    <UiCommonIcon v-for="index in 5" :key="index" name="star" size-class="size-4" :class="rating && index <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'" />
  </span>
</template>
```

`app/components/Gbp/Reviews/ReplyForm.vue`:

```vue
<script setup lang="ts">
import type { GbpReview } from '~/types/domain'

// 1 件の口コミへの返信（新規・編集）。テンプレートを選ぶと差し込みを展開して入力欄に入れる

interface Props {
  review: GbpReview
  storeName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ done: [] }>()

const { replyToReviews } = useGbpReviews()
const { templates } = useReplyTemplates()
const { isPending, errorMessage, run } = useActionState()

const comment = ref(props.review.reply?.comment ?? '')
const templateId = ref<string>('')
const byteLength = computed(() => utf8ByteLength(comment.value))
const templateOptions = computed(() => [{ value: '', label: 'テンプレートを使う' }, ...templates.value.map(item => ({ value: item.id, label: item.name }))])

watch(templateId, (id) => {
  const template = templates.value.find(item => item.id === id)
  if (template) comment.value = expandReplyTemplate(template.body, { reviewerName: props.review.reviewerName, storeName: props.storeName })
})

async function onSubmit(): Promise<void> {
  const result = await run(() => replyToReviews([{ reviewId: props.review.id, comment: comment.value.trim() }]))
  if (!result) return
  if (result.failed.length > 0) {
    errorMessage.value = result.failed[0]!.message
    return
  }
  emit('done')
}
</script>

<template>
  <form class="space-y-2" @submit.prevent="onSubmit">
    <div v-if="templates.length > 0" class="w-full sm:w-60">
      <UiInputSelectField v-model="templateId" label="テンプレート" :options="templateOptions" is-label-hidden />
    </div>
    <UiInputTextareaField v-model="comment" label="返信" is-label-hidden :rows="4" :hint="`${byteLength} / ${MAX_REPLY_BYTES} バイト`" :error="byteLength > MAX_REPLY_BYTES ? '長すぎます' : null" />
    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <div class="flex justify-end gap-2">
      <UiCommonButton variant="secondary" size="sm" @click="emit('done')">キャンセル</UiCommonButton>
      <UiCommonButton type="submit" size="sm" :is-loading="isPending" :is-disabled="comment.trim() === '' || byteLength > MAX_REPLY_BYTES">
        {{ review.hasReply ? '返信を更新' : '返信する' }}
      </UiCommonButton>
    </div>
  </form>
</template>
```

> `UiInputTextareaField` に `isLabelHidden` が無い場合は、ラベルを表示したまま使う（props を確認する）。

- [ ] **Step 2: 口コミカードを作る**

`app/components/Gbp/Reviews/ReviewCard.vue`:

```vue
<script setup lang="ts">
import type { GbpReview } from '~/types/domain'

interface Props {
  review: GbpReview
  storeName: string
  isSelected: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:isSelected': [value: boolean] }>()

const { deleteReply } = useGbpReviews()
const { show } = useToast()
const deleteState = useActionState()
const isEditing = ref(false)

async function onDeleteReply(): Promise<void> {
  await deleteState.run(() => deleteReply(props.review.id))
  if (!deleteState.errorMessage.value) show('返信を削除しました')
}
</script>

<template>
  <li class="rounded-xl border bg-white p-4 sm:p-5" :class="isSelected ? 'border-brand-400 ring-1 ring-brand-200' : 'border-slate-200'">
    <div class="flex items-start gap-3">
      <input
        type="checkbox"
        class="mt-1 size-4"
        :checked="isSelected"
        :aria-label="`${review.reviewerName} の口コミを選択`"
        @change="emit('update:isSelected', ($event.target as HTMLInputElement).checked)"
      >
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-medium text-slate-900">{{ review.reviewerName }}</span>
          <GbpReviewsStarRating :rating="review.starRating" />
          <span class="text-xs text-slate-500">{{ storeName }}・{{ formatDate(review.reviewCreatedAt) }}</span>
          <UiCommonBadge :tone="review.hasReply ? 'success' : 'warning'">{{ review.hasReply ? '返信済み' : '未返信' }}</UiCommonBadge>
        </div>
        <p class="text-sm whitespace-pre-wrap text-slate-700">{{ review.comment ?? '（評価のみ）' }}</p>

        <div v-if="review.reply && !isEditing" class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <p class="text-xs text-slate-500">オーナーからの返信・{{ formatDate(review.reply.updatedAt) }}</p>
          <p class="whitespace-pre-wrap text-slate-700">{{ review.reply.comment }}</p>
          <div class="mt-2 flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="isEditing = true">編集</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" :is-loading="deleteState.isPending.value" @click="onDeleteReply">削除</UiCommonButton>
          </div>
          <UiCommonAlert v-if="deleteState.errorMessage.value" tone="danger" class="mt-2">{{ deleteState.errorMessage.value }}</UiCommonAlert>
        </div>
        <GbpReviewsReplyForm v-else-if="isEditing" :review="review" :store-name="storeName" @done="isEditing = false" />
        <UiCommonButton v-else size="sm" variant="secondary" @click="isEditing = true">返信する</UiCommonButton>
      </div>
    </div>
  </li>
</template>
```

- [ ] **Step 3: 一括返信とテンプレート管理のモーダルを作る**

`app/components/Gbp/Reviews/BulkReplyModal.vue`:

```vue
<script setup lang="ts">
import type { BatchResult, GbpReview } from '~/types/domain'

// 選んだ口コミに同じ文面で返信する。差し込みは口コミごとに展開してから送る（プレビューと送信内容を一致させる）

interface Props {
  reviews: GbpReview[]
}

const props = defineProps<Props>()
const isOpen = defineModel<boolean>({ required: true })
const emit = defineEmits<{ finished: [result: BatchResult] }>()

const { replyToReviews } = useGbpReviews()
const { templates } = useReplyTemplates()
const { storeName } = useCurrentOrg()
const { isPending, errorMessage, run } = useActionState()

const body = ref('')
const templateId = ref('')
const templateOptions = computed(() => [{ value: '', label: 'テンプレートを使う' }, ...templates.value.map(item => ({ value: item.id, label: item.name }))])

watch(templateId, (id) => {
  const template = templates.value.find(item => item.id === id)
  if (template) body.value = template.body
})
watch(isOpen, (value) => { if (value) { body.value = ''; templateId.value = '' } })

const expanded = computed(() => props.reviews.map(review => ({
  review,
  comment: expandReplyTemplate(body.value, { reviewerName: review.reviewerName, storeName: storeName(review.storeId) }),
})))
const tooLong = computed(() => expanded.value.filter(item => utf8ByteLength(item.comment) > MAX_REPLY_BYTES))
const canSubmit = computed(() => body.value.trim() !== '' && tooLong.value.length === 0 && props.reviews.length > 0)

async function onSubmit(): Promise<void> {
  const result = await run(() => replyToReviews(expanded.value.map(item => ({ reviewId: item.review.id, comment: item.comment }))))
  if (!result) return
  emit('finished', result)
  if (result.failed.length === 0) isOpen.value = false
}
</script>

<template>
  <UiCommonModal v-model="isOpen" :title="`${reviews.length} 件の口コミに返信`" size="lg">
    <div class="space-y-4">
      <div v-if="templates.length > 0" class="w-full sm:w-60">
        <UiInputSelectField v-model="templateId" label="テンプレート" :options="templateOptions" is-label-hidden />
      </div>
      <UiInputTextareaField v-model="body" label="返信の文面" :rows="5" :hint="`差し込み: ${REPLY_PLACEHOLDERS.join(' ')}`" />
      <div v-if="expanded[0] && body.trim()" class="space-y-1">
        <p class="text-xs font-medium text-slate-500">プレビュー（{{ expanded[0].review.reviewerName }} さんへの返信）</p>
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">{{ expanded[0].comment }}</p>
      </div>
      <UiCommonAlert v-if="tooLong.length > 0" tone="danger">{{ tooLong.length }} 件の返信が 4096 バイトを超えています。文面を短くしてください。</UiCommonAlert>
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    </div>
    <template #footer>
      <UiCommonButton variant="secondary" @click="isOpen = false">キャンセル</UiCommonButton>
      <UiCommonButton :is-loading="isPending" :is-disabled="!canSubmit" @click="onSubmit">{{ reviews.length }} 件に返信する</UiCommonButton>
    </template>
  </UiCommonModal>
</template>
```

`app/components/Gbp/Reviews/TemplateManagerModal.vue`:

```vue
<script setup lang="ts">
import type { ReplyTemplate } from '~/types/domain'

// 返信テンプレートの追加・編集・削除（owner / admin）

const isOpen = defineModel<boolean>({ required: true })
const { templates, createTemplate, updateTemplate, deleteTemplate } = useReplyTemplates()
const { canManage } = useCurrentOrg()
const { isPending, errorMessage, run } = useActionState()

const editingId = ref<string | null>(null)
const name = ref('')
const body = ref('')

function onEdit(template: ReplyTemplate | null): void {
  editingId.value = template?.id ?? 'new'
  name.value = template?.name ?? ''
  body.value = template?.body ?? ''
}

async function onSave(): Promise<void> {
  const input = { name: name.value, body: body.value }
  const isDone = await run(async () => {
    if (editingId.value === 'new') await createTemplate(input)
    else await updateTemplate(editingId.value!, input)
    return true
  })
  if (isDone) editingId.value = null
}

async function onDelete(templateId: string): Promise<void> {
  await run(() => deleteTemplate(templateId))
}
</script>

<template>
  <UiCommonModal v-model="isOpen" title="返信テンプレート" size="lg">
    <div class="space-y-4">
      <p class="text-sm text-slate-600">差し込み {{ REPLY_PLACEHOLDERS.join(' ') }} は、返信するときに口コミごとの値に置き換わります。</p>
      <ul class="divide-y divide-slate-100 rounded-lg border border-slate-200">
        <li v-if="templates.length === 0" class="p-4 text-sm text-slate-500">テンプレートはまだありません。</li>
        <li v-for="template in templates" :key="template.id" class="flex flex-wrap items-start gap-3 p-4">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-900">{{ template.name }}</p>
            <p class="text-sm whitespace-pre-wrap text-slate-600">{{ template.body }}</p>
          </div>
          <div v-if="canManage" class="flex gap-2">
            <UiCommonButton size="sm" variant="secondary" @click="onEdit(template)">編集</UiCommonButton>
            <UiCommonButton size="sm" variant="ghost" @click="onDelete(template.id)">削除</UiCommonButton>
          </div>
        </li>
      </ul>
      <form v-if="editingId" class="space-y-3 rounded-lg bg-slate-50 p-4" @submit.prevent="onSave">
        <UiInputTextField v-model="name" label="テンプレート名" :maxlength="50" is-required />
        <UiInputTextareaField v-model="body" label="本文" :rows="5" :maxlength="2000" is-required />
        <div class="flex justify-end gap-2">
          <UiCommonButton variant="secondary" size="sm" @click="editingId = null">キャンセル</UiCommonButton>
          <UiCommonButton type="submit" size="sm" :is-loading="isPending">保存</UiCommonButton>
        </div>
      </form>
      <UiCommonButton v-else-if="canManage" variant="secondary" size="sm" icon="plus" @click="onEdit(null)">テンプレートを追加</UiCommonButton>
      <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    </div>
  </UiCommonModal>
</template>
```

- [ ] **Step 4: 口コミ画面を作る**

`app/pages/admin/[orgId]/reviews/index.vue`:

```vue
<script setup lang="ts">
import type { BatchResult } from '~/types/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: '口コミ' })

// GBP の口コミ一覧。個別返信と、選んだ口コミへの一括返信

const { storeName } = useCurrentOrg()
const { reviews, syncReviews } = useGbpReviews()
const { show } = useToast()

const storeFilter = ref<string | null>(null)
const replyFilter = ref<'all' | 'unreplied' | 'replied'>('unreplied')
const ratingFilter = ref<'all' | '1' | '2' | '3' | '4' | '5'>('all')
const replyOptions = [
  { value: 'all' as const, label: 'すべて' },
  { value: 'unreplied' as const, label: '未返信' },
  { value: 'replied' as const, label: '返信済み' },
]
const ratingOptions = [{ value: 'all' as const, label: 'すべての評価' }, ...(['5', '4', '3', '2', '1'] as const).map(value => ({ value, label: `星 ${value}` }))]

const filteredReviews = computed(() => reviews.value.filter(review =>
  (storeFilter.value === null || review.storeId === storeFilter.value)
  && (replyFilter.value === 'all' || (replyFilter.value === 'replied') === review.hasReply)
  && (ratingFilter.value === 'all' || review.starRating === Number(ratingFilter.value))))

const selectedIds = ref<string[]>([])
const selectedReviews = computed(() => reviews.value.filter(review => selectedIds.value.includes(review.id)))
const isAllSelected = computed(() => filteredReviews.value.length > 0 && filteredReviews.value.every(review => selectedIds.value.includes(review.id)))

function onSelect(reviewId: string, isSelected: boolean): void {
  selectedIds.value = isSelected ? [...selectedIds.value, reviewId] : selectedIds.value.filter(id => id !== reviewId)
}

function onSelectAll(isSelected: boolean): void {
  selectedIds.value = isSelected ? filteredReviews.value.slice(0, 50).map(review => review.id) : []
}

const isBulkOpen = ref(false)
const isTemplatesOpen = ref(false)
const lastFailures = ref<BatchResult['failed']>([])

function onBulkFinished(result: BatchResult): void {
  lastFailures.value = result.failed
  // 失敗した口コミだけを選択状態に残し、再送できるようにする
  selectedIds.value = result.failed.map(item => item.id)
  if (result.succeeded.length > 0) show(`${result.succeeded.length} 件に返信しました`)
}

const syncState = useActionState()
async function onSync(): Promise<void> {
  const result = await syncState.run(() => syncReviews())
  if (!result) return
  lastFailures.value = result.failed
  show(result.failed.length === 0 ? '口コミを同期しました' : `${result.failed.length} 店舗の同期に失敗しました`, result.failed.length === 0 ? 'success' : 'danger')
}

function failureLabel(id: string): string {
  const review = reviews.value.find(item => item.id === id)
  return review ? `${review.reviewerName}（${storeName(review.storeId)}）` : storeName(id)
}
</script>

<template>
  <div>
    <UiCommonPageHeader title="口コミ" description="Google の口コミを確認し、返信します（毎朝 6 時に自動で同期します）">
      <template #actions>
        <UiCommonButton variant="secondary" @click="isTemplatesOpen = true">テンプレート</UiCommonButton>
        <UiCommonButton icon="refresh" variant="secondary" :is-loading="syncState.isPending.value" @click="onSync">同期</UiCommonButton>
      </template>
    </UiCommonPageHeader>

    <div class="mb-4 flex flex-wrap gap-3">
      <AdminCommonStoreFilter v-model="storeFilter" />
      <div class="w-full sm:w-36">
        <UiInputSelectField v-model="replyFilter" label="返信" :options="replyOptions" is-label-hidden />
      </div>
      <div class="w-full sm:w-36">
        <UiInputSelectField v-model="ratingFilter" label="評価" :options="ratingOptions" is-label-hidden />
      </div>
    </div>

    <UiCommonAlert v-if="syncState.errorMessage.value" tone="danger" class="mb-4">{{ syncState.errorMessage.value }}</UiCommonAlert>
    <UiCommonAlert v-if="lastFailures.length > 0" tone="danger" title="処理できなかったもの" class="mb-4">
      <ul class="list-disc pl-5">
        <li v-for="failure in lastFailures" :key="failure.id">{{ failureLabel(failure.id) }}: {{ failure.message }}</li>
      </ul>
    </UiCommonAlert>

    <div class="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2">
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" class="size-4" :checked="isAllSelected" @change="onSelectAll(($event.target as HTMLInputElement).checked)">
        表示中をすべて選択（最大 50 件）
      </label>
      <span class="text-sm text-slate-500">{{ selectedIds.length }} 件選択中</span>
      <UiCommonButton class="ml-auto" size="sm" :is-disabled="selectedIds.length === 0 || selectedIds.length > 50" @click="isBulkOpen = true">一括返信</UiCommonButton>
    </div>

    <p v-if="filteredReviews.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
      条件に合う口コミはありません。
    </p>
    <ul v-else class="grid gap-3">
      <GbpReviewsReviewCard
        v-for="review in filteredReviews"
        :key="review.id"
        :review="review"
        :store-name="storeName(review.storeId)"
        :is-selected="selectedIds.includes(review.id)"
        @update:is-selected="onSelect(review.id, $event)"
      />
    </ul>

    <GbpReviewsBulkReplyModal v-model="isBulkOpen" :reviews="selectedReviews" @finished="onBulkFinished" />
    <GbpReviewsTemplateManagerModal v-model="isTemplatesOpen" />
  </div>
</template>
```

- [ ] **Step 5: 型チェックとモックの表示を確認する**

Run: `npm run typecheck`
Expected: エラー 0 件

Run: `npm run dev`（モック）で法人オーナー → 口コミ画面:

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 初期表示 | 未返信の口コミだけが新しい順に出る。評価のみの口コミは「（評価のみ）」 |
| 2 | 1 件の「返信する」でテンプレート「お礼（高評価）」を選ぶ | 投稿者名と店舗名が展開された文面が入る。送信すると一覧から消える（未返信フィルタ） |
| 3 | 返信済みに切り替え → 「編集」で文面を変えて更新 / 「削除」 | 反映される |
| 4 | 3 件選んで「一括返信」→ `{投稿者名}様 ありがとうございました` | プレビューに 1 件目の投稿者名が展開される。送信後「3 件に返信しました」 |
| 5 | テンプレート管理で追加・編集・削除 | 反映される |
| 6 | 長い文面（日本語 1,400 文字）を入力 | バイト数の警告が出て送信できない |
| 7 | スタッフでログイン | 担当の渋谷店の口コミだけが出る。テンプレートの編集ボタンが無い |

---

### Task 10: Emulator での確認と PROJECT.md

**Files:**
- Modify: `.claude/PROJECT.md`

- [ ] **Step 1: Emulator と本物モードを起動する**

計画 3 の Task 8 Step 1 と同じコマンドで起動する。

- [ ] **Step 2: キャッシュを直接入れて画面を確認する**

本物の GBP は呼べないため、Emulator の Firestore にプロフィール・口コミを直接入れて、画面の表示と、GBP を呼ぶ操作が「連携が無い」理由で失敗することを確認する。

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 法人で新規登録 → ナビ | 「Google ビジネス」にプロフィール・口コミがあり、準備中バッジが無い |
| 2 | プロフィール・口コミ画面（店舗 0 件） | 空の案内が出る |
| 3 | Emulator の REST で `stores/st-1`（連携情報付き）・`gbpProfiles/st-1`・`gbpReviews/r-1` を作成 | 一覧に表示される（購読が効いている） |
| 4 | 口コミに返信 | 「Google 連携が見つかりません。」など、連携が無い理由が画面に出る（失敗一覧に理由） |
| 5 | テンプレートを追加 | Functions 経由で保存され、一覧に出る |

Emulator の REST で書き込むときは、ブラウザから `fetch('http://127.0.0.1:8080/v1/projects/meo-tool-d98e5/databases/(default)/documents/organizations/{orgId}/stores?documentId=st-1', { method: 'POST', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { ... } }) })` を使う（`Bearer owner` はルールを無視する Emulator 専用のトークン）。

- [ ] **Step 3: PROJECT.md に追記する**

`.claude/PROJECT.md` の「モード」の表の下の箇条書きに追加する。

```markdown
- GBP の口コミは毎朝 6:00（JST）に `scheduledGbpReviewsSync` が自動同期する。画面の「同期」は手動の即時同期
- 口コミの表示は新しい順に最大 500 件（`useFirestoreSync` の `REVIEW_LIMIT`）
```

`Firestore` の表に追加する。

```markdown
| GBP のキャッシュ | `gbpProfiles/{storeId}`・`gbpReviews/{reviewId}`・`replyTemplates/{id}`（読み取りはメンバー、staff は担当店舗のみ。書き込みは Functions のみ） |
```

- [ ] **Step 4: 全テストを最終確認する**

Run: `cd functions && npm test && npm run build`、ルートで `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emulator`、`npm run typecheck`
Expected: 単体 59 件 PASS、Emulator 82 件 PASS、ビルド成功、型エラー 0 件

---

## 完了条件

- Functions の単体テスト 59 件・Emulator テスト 82 件が PASS、型エラー 0 件
- モックで プロフィール一覧・編集、口コミの個別返信・一括返信・返信削除・テンプレート管理が動く
- 本物モードで画面が準備中にならず、キャッシュの表示と、GBP を呼ぶ操作のエラー表示が動く
- 実際の GBP への反映は、GBP API の承認と連携ができた時点で確認する（本計画の範囲外）
