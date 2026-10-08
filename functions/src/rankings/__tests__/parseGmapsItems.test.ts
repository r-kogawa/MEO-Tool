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

test('parseGmapsItems: aria-label に件数がなければ本文の「4.1(195)」から取る', () => {
  const [result] = parseGmapsItems([item(1, { starLabel: '4.1 つ星', text: '店1\n店1\n4.1(195)\nカフェ・喫茶 · 渋谷' })])
  assert.equal(result!.reviewCount, 195)
  assert.equal(result!.category, 'カフェ・喫茶')
})

test('parseGmapsItems: 本文の「4.4(2,123)」のカンマ付き件数を取る', () => {
  const [result] = parseGmapsItems([item(1, { starLabel: '4.4 つ星', text: '店1\n4.4(2,123)\nカフェ・喫茶 · 渋谷' })])
  assert.equal(result!.reviewCount, 2123)
})

test('parseGmapsItems: aria-label の件数を本文より優先する', () => {
  const [result] = parseGmapsItems([item(1, { starLabel: '4.1 つ星 クチコミ 195 件', text: '店1\n4.1(999)\nカフェ・喫茶 · 渋谷' })])
  assert.equal(result!.reviewCount, 195)
})

test('parseGmapsItems: 評価だけの「4.1」行があってもカテゴリはカフェ・喫茶、数字だけの店名行は消さない', () => {
  const [result] = parseGmapsItems([item(1, { starLabel: '4.1 つ星', text: '店1\n店1\n4.1\nカフェ・喫茶 ·  · 神南１丁目' })])
  assert.equal(result!.category, 'カフェ・喫茶')
  const [numeric] = parseGmapsItems([item(2, { name: '109', text: '109\n109\nショッピングモール · 渋谷' })])
  assert.equal(numeric!.category, 'ショッピングモール')
})
