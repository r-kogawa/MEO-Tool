import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLocalPost, readPostInput, toLocalPostInput } from '../postMapping'

const invalid = { code: 'invalid-argument' }
const EVENT_PERIOD = { title: '秋祭り', startAt: '2026-10-10T10:00', endAt: '2026-10-12T18:30' }

test('readPostInput / toLocalPostInput: 最新情報（画像・ボタン付き）', () => {
  const post = readPostInput({
    topicType: 'STANDARD', summary: ' 秋の新メニュー ', mediaUrl: 'https://example.com/a.jpg',
    callToAction: { actionType: 'BOOK', url: 'https://example.com/book' },
  })
  assert.deepEqual(post, {
    topicType: 'STANDARD', summary: '秋の新メニュー', mediaUrl: 'https://example.com/a.jpg',
    callToAction: { actionType: 'BOOK', url: 'https://example.com/book' }, event: null, offer: null,
  })
  assert.deepEqual(toLocalPostInput(post), {
    languageCode: 'ja', summary: '秋の新メニュー', topicType: 'STANDARD',
    media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://example.com/a.jpg' }],
    callToAction: { actionType: 'BOOK', url: 'https://example.com/book' },
  })
})

test('電話ボタン（CALL）は URL を持たない', () => {
  const post = readPostInput({ topicType: 'STANDARD', summary: 'a', callToAction: { actionType: 'CALL', url: 'https://ignored.example' } })
  assert.deepEqual(post.callToAction, { actionType: 'CALL', url: null })
  assert.deepEqual(toLocalPostInput(post).callToAction, { actionType: 'CALL' })
})

test('イベント: 期間を GBP の日付と時刻に分け、空の本文は送らない', () => {
  const post = readPostInput({ topicType: 'EVENT', summary: '', event: EVENT_PERIOD })
  assert.deepEqual(toLocalPostInput(post), {
    languageCode: 'ja', topicType: 'EVENT',
    event: { title: '秋祭り', schedule: {
      startDate: { year: 2026, month: 10, day: 10 }, startTime: { hours: 10, minutes: 0 },
      endDate: { year: 2026, month: 10, day: 12 }, endTime: { hours: 18, minutes: 30 },
    } },
  })
})

test('イベント: 日・月をまたぐ期間も往復で同じ文字列に戻る', () => {
  const event = { title: 'ハロウィン', startAt: '2026-10-31T18:00', endAt: '2026-11-01T02:00' }
  const body = toLocalPostInput(readPostInput({ topicType: 'EVENT', event }))
  assert.deepEqual(body.event!.schedule.endDate, { year: 2026, month: 11, day: 1 })
  assert.deepEqual(fromLocalPost({ ...body, name: 'n' })!.event, event)
})

test('特典: ボタンは付けず、空のクーポン項目は送らない', () => {
  const post = readPostInput({
    topicType: 'OFFER', summary: '10%オフ', event: { title: '秋の特典', startAt: '2026-10-01T00:00', endAt: '2026-10-31T23:59' },
    offer: { couponCode: 'AUTUMN', redeemOnlineUrl: '', termsConditions: ' ' },
  })
  assert.deepEqual(post.offer, { couponCode: 'AUTUMN', redeemOnlineUrl: '', termsConditions: '' })
  assert.deepEqual(toLocalPostInput(post).offer, { couponCode: 'AUTUMN' })
  assert.equal(toLocalPostInput(post).callToAction, undefined)
})

test('readPostInput: 入力不正は invalid-argument', () => {
  assert.throws(() => readPostInput({ topicType: 'ALERT', summary: 'a' }), invalid)
  assert.throws(() => readPostInput({ topicType: 'STANDARD', summary: '' }), { message: '本文を入力してください。' })
  assert.throws(() => readPostInput({ topicType: 'STANDARD', summary: 'あ'.repeat(1501) }), { message: '本文は 1500 文字以内にしてください。' })
  assert.doesNotThrow(() => readPostInput({ topicType: 'STANDARD', summary: 'あ'.repeat(1500) }))
  assert.throws(() => readPostInput({ topicType: 'STANDARD', summary: 'a', mediaUrl: 'ftp://example.com/a.jpg' }), invalid)
  assert.throws(() => readPostInput({ topicType: 'STANDARD', summary: 'a', callToAction: { actionType: 'LEARN_MORE' } }), invalid)
  assert.throws(() => readPostInput({ topicType: 'STANDARD', summary: 'a', event: EVENT_PERIOD }), { message: '最新情報にはタイトルと期間を設定できません。' })
  assert.throws(
    () => readPostInput({ topicType: 'OFFER', event: EVENT_PERIOD, callToAction: { actionType: 'SHOP', url: 'https://example.com' } }),
    { message: '特典の投稿にはボタンを付けられません。' },
  )
  assert.throws(() => readPostInput({ topicType: 'EVENT', summary: 'a' }), { message: 'タイトルと期間を入力してください。' })
  assert.throws(() => readPostInput({ topicType: 'EVENT', event: { ...EVENT_PERIOD, title: 'あ'.repeat(59) } }), invalid)
  assert.throws(
    () => readPostInput({ topicType: 'EVENT', event: { title: 'a', startAt: '2026-10-10T10:00', endAt: '2026-10-10T10:00' } }),
    { message: '終了日時は開始日時より後にしてください。' },
  )
  for (const startAt of ['2026-02-30T10:00', '2026-10-10T24:00', '2026-10-10 10:00', '']) {
    assert.throws(() => readPostInput({ topicType: 'EVENT', event: { title: 'a', startAt, endAt: '2027-01-01T00:00' } }), invalid)
  }
})

test('fromLocalPost: GBP の投稿を画面用の形にする（ALERT は対象外、状態は 3 種にまとめる）', () => {
  assert.deepEqual(fromLocalPost({
    name: 'n', languageCode: 'ja', topicType: 'OFFER', summary: '10%オフ', state: 'PROCESSING', searchUrl: 'https://search.example',
    media: [{ mediaFormat: 'PHOTO', googleUrl: 'https://lh3.example/p.jpg' }],
    event: { title: '特典', schedule: { startDate: { year: 2026, month: 10, day: 1 }, endDate: { year: 2026, month: 10, day: 31 } } },
    offer: { couponCode: 'A' },
  }), {
    topicType: 'OFFER', summary: '10%オフ', mediaUrl: 'https://lh3.example/p.jpg', callToAction: null,
    event: { title: '特典', startAt: '2026-10-01T00:00', endAt: '2026-10-31T23:59' },
    offer: { couponCode: 'A', redeemOnlineUrl: '', termsConditions: '' },
    state: 'PROCESSING', searchUrl: 'https://search.example',
  })
  assert.equal(fromLocalPost({ name: 'n', languageCode: 'ja', topicType: 'ALERT', summary: 'x' }), null)
  assert.equal(fromLocalPost({ name: 'n', languageCode: 'ja', topicType: 'STANDARD', summary: 'x', state: 'SCHEDULED' })!.state, 'PROCESSING')
  assert.equal(fromLocalPost({ name: 'n', languageCode: 'ja', topicType: 'STANDARD', summary: 'x', state: 'REJECTED' })!.state, 'REJECTED')
  assert.equal(fromLocalPost({ name: 'n', languageCode: 'ja', topicType: 'STANDARD', summary: 'x', state: 'LIVE' })!.state, 'LIVE')
})
