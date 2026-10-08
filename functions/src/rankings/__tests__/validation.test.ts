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
