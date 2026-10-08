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
