import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GbpLocalPostInput } from '../types'
import { createTestClient } from './helpers'

const V4 = 'https://mybusiness.googleapis.com/v4'
const LOCATION = 'accounts/1/locations/2'

test('listLocalPosts: pageSize=100 で全ページ取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { localPosts: [{ name: `${LOCATION}/localPosts/p1`, summary: 'a', topicType: 'STANDARD', languageCode: 'ja' }], nextPageToken: 'n' } },
    { status: 200, body: {} },
  ])

  const posts = await client.listLocalPosts(LOCATION)

  assert.deepEqual(posts.map(p => p.name), [`${LOCATION}/localPosts/p1`])
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts?pageSize=100`)
  assert.equal(calls[1].url, `${V4}/${LOCATION}/localPosts?pageSize=100&pageToken=n`)
})

test('createLocalPost: イベント投稿をそのままの形で POST する', async () => {
  const post: GbpLocalPostInput = {
    languageCode: 'ja',
    summary: '秋のフェア開催',
    topicType: 'EVENT',
    callToAction: { actionType: 'LEARN_MORE', url: 'https://example.com/fair' },
    media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://example.com/a.jpg' }],
    event: {
      title: '秋のフェア',
      schedule: {
        startDate: { year: 2026, month: 10, day: 10 },
        startTime: { hours: 10, minutes: 0 },
        endDate: { year: 2026, month: 10, day: 20 },
        endTime: { hours: 18, minutes: 0 },
      },
    },
  }
  const { client, calls } = createTestClient([
    { status: 200, body: { ...post, name: `${LOCATION}/localPosts/p9`, state: 'PROCESSING', searchUrl: 'https://g.co/x' } },
  ])

  const created = await client.createLocalPost(LOCATION, post)

  assert.equal(created.name, `${LOCATION}/localPosts/p9`)
  assert.equal(created.state, 'PROCESSING')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts`)
  assert.deepEqual(calls[0].body, post)
})

test('createLocalPost: 5xx でも再試行しない（POST は冪等でないため二重投稿を防ぐ）', async () => {
  const { client, calls } = createTestClient([{ status: 503, body: '' }])
  await assert.rejects(
    client.createLocalPost(LOCATION, { languageCode: 'ja', summary: 'a', topicType: 'STANDARD' }),
    { name: 'GbpApiError', status: 503 },
  )
  assert.equal(calls.length, 1)
})

test('createLocalPost: 429 は再試行する（Google が処理していないことが確実なため）', async () => {
  const { client, calls } = createTestClient([
    { status: 429, body: '' },
    { status: 200, body: { name: `${LOCATION}/localPosts/p1`, languageCode: 'ja', summary: 'a', topicType: 'STANDARD' } },
  ])
  await client.createLocalPost(LOCATION, { languageCode: 'ja', summary: 'a', topicType: 'STANDARD' })
  assert.equal(calls.length, 2)
})

test('deleteLocalPost: 投稿名に DELETE する', async () => {
  const { client, calls } = createTestClient([{ status: 200, body: {} }])

  await client.deleteLocalPost(`${LOCATION}/localPosts/p1`)

  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, `${V4}/${LOCATION}/localPosts/p1`)
})
