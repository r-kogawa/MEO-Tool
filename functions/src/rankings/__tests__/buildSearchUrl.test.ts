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
