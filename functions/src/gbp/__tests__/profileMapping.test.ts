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

test('toLocationPatch: 閉店が開店以前の特別営業時間は endDate を翌日にする（日をまたぐ営業）', () => {
  const { patch } = toLocationPatch({ specialHours: [{ date: '2026-12-31', isClosed: false, openTime: '18:00', closeTime: '02:00' }] })
  assert.deepEqual(patch.specialHours, { specialHourPeriods: [
    { startDate: { year: 2026, month: 12, day: 31 }, endDate: { year: 2027, month: 1, day: 1 }, openTime: { hours: 18, minutes: 0 }, closeTime: { hours: 2, minutes: 0 } },
  ] })
})

test('toProfileFields → toLocationPatch: 日をまたぐ特別営業時間が往復しても同じ GBP の形に戻る', () => {
  const original = { startDate: { year: 2026, month: 12, day: 31 }, endDate: { year: 2027, month: 1, day: 1 }, openTime: { hours: 18, minutes: 0 }, closeTime: { hours: 2, minutes: 0 } }
  const fields = toProfileFields({ name: 'locations/1', specialHours: { specialHourPeriods: [original] } })
  assert.deepEqual(fields.specialHours, [{ date: '2026-12-31', isClosed: false, openTime: '18:00', closeTime: '02:00' }])
  assert.deepEqual(toLocationPatch({ specialHours: fields.specialHours }).patch.specialHours, { specialHourPeriods: [original] })
})
