import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestClient } from './helpers'

const V4 = 'https://mybusiness.googleapis.com/v4'
const LOCATION = 'accounts/1/locations/2'
const REVIEW = `${LOCATION}/reviews/r1`

const review = (id: string) => ({
  name: `${LOCATION}/reviews/${id}`,
  reviewId: id,
  reviewer: { displayName: '山田' },
  starRating: 'FIVE',
  createTime: '2026-10-01T00:00:00Z',
  updateTime: '2026-10-01T00:00:00Z',
})

test('listReviews: 既定 pageSize=50 で 1 ページ取得し、集計値も返す', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { reviews: [review('r1')], averageRating: 4.5, totalReviewCount: 10, nextPageToken: 'n' } },
  ])

  const page = await client.listReviews(LOCATION, { orderBy: 'updateTime desc' })

  assert.equal(page.reviews?.length, 1)
  assert.equal(page.averageRating, 4.5)
  assert.equal(page.nextPageToken, 'n')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/reviews?pageSize=50&orderBy=updateTime+desc`)
})

test('listAllReviews: 全ページを結合する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { reviews: [review('r1')], nextPageToken: 'n' } },
    { status: 200, body: { reviews: [review('r2')] } },
  ])

  const reviews = await client.listAllReviews(LOCATION)

  assert.deepEqual(reviews.map(r => r.reviewId), ['r1', 'r2'])
  assert.equal(calls[1].url, `${V4}/${LOCATION}/reviews?pageSize=50&pageToken=n`)
})

test('listAllReviews: 口コミ 0 件（reviews 省略）は空配列', async () => {
  const { client } = createTestClient([{ status: 200, body: { totalReviewCount: 0 } }])
  assert.deepEqual(await client.listAllReviews(LOCATION), [])
})

test('updateReviewReply: reply に comment を PUT する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { comment: 'ありがとうございます', updateTime: '2026-10-07T00:00:00Z' } },
  ])

  const reply = await client.updateReviewReply(REVIEW, 'ありがとうございます')

  assert.equal(reply.comment, 'ありがとうございます')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(calls[0].url, `${V4}/${REVIEW}/reply`)
  assert.deepEqual(calls[0].body, { comment: 'ありがとうございます' })
})

test('deleteReviewReply: 空ボディの 200 でも正常終了する', async () => {
  const { client, calls } = createTestClient([{ status: 200 }])

  await client.deleteReviewReply(REVIEW)

  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, `${V4}/${REVIEW}/reply`)
})

test('deleteReviewReply: 204 No Content でも正常終了する', async () => {
  const { client } = createTestClient([{ status: 204 }])
  await client.deleteReviewReply(REVIEW)
})
