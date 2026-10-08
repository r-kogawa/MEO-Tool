import { test } from 'node:test'
import assert from 'node:assert/strict'
import { starRatingToNumber, toV4LocationPath } from '../utils'

test('toV4LocationPath: v1 のアカウント名とロケーション名を v4 のパスにする', () => {
  assert.equal(toV4LocationPath('accounts/123', 'locations/456'), 'accounts/123/locations/456')
})

test('toV4LocationPath: 形式違いのリソース名は例外', () => {
  assert.throws(() => toV4LocationPath('123', 'locations/456'), /accountName/)
  assert.throws(() => toV4LocationPath('accounts/123', '456'), /locationName/)
  assert.throws(() => toV4LocationPath('accounts/123', 'accounts/1/locations/2'), /locationName/)
  assert.throws(() => toV4LocationPath('accounts/', 'locations/456'), /accountName/)
})

test('starRatingToNumber: ONE〜FIVE を 1〜5 に、未指定は null', () => {
  assert.equal(starRatingToNumber('ONE'), 1)
  assert.equal(starRatingToNumber('THREE'), 3)
  assert.equal(starRatingToNumber('FIVE'), 5)
  assert.equal(starRatingToNumber('STAR_RATING_UNSPECIFIED'), null)
})
