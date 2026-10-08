import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResponsesCsv, escapeCsvCell, type CsvVersion } from '../csv'

const V1: CsvVersion = {
  version: 1,
  questions: [
    { id: 'q-overall', type: 'rating', label: '満足度', isRequired: true, options: [], useForReviewDraft: true },
    {
      id: 'q-good',
      type: 'multi',
      label: '良かった点',
      isRequired: false,
      options: [{ id: 'o-taste', label: '味' }, { id: 'o-service', label: '接客' }],
      useForReviewDraft: true,
    },
  ],
}
const V2: CsvVersion = {
  version: 2,
  questions: [
    { id: 'q-overall', type: 'rating', label: '総合満足度', isRequired: true, options: [], useForReviewDraft: true },
    { id: 'q-comment', type: 'text', label: 'ご感想', isRequired: false, options: [], useForReviewDraft: true },
  ],
}

test('buildResponsesCsv: バージョンをまたいで設問 ID で列をそろえる（設問文は新しい版のもの）。文面の列は出さない', () => {
  const csv = buildResponsesCsv([V2, V1], [
    {
      createdAt: new Date('2026-10-08T01:00:00.000Z'),
      surveyVersion: 2,
      answers: { 'q-overall': 5, 'q-comment': 'おいしい' },
      isEligible: true,
      redirectedAt: new Date('2026-10-08T01:01:00.000Z'),
    },
    {
      createdAt: new Date('2026-10-07T01:00:00.000Z'),
      surveyVersion: 1,
      answers: { 'q-overall': 2, 'q-good': ['o-taste', 'o-service'] },
      isEligible: false,
      redirectedAt: null,
    },
  ])
  assert.equal(csv, [
    '回答日時,バージョン,総合満足度,良かった点,ご感想,条件合致,Google 遷移日時',
    '2026-10-08T01:00:00.000Z,2,5,,おいしい,○,2026-10-08T01:01:00.000Z',
    '2026-10-07T01:00:00.000Z,1,2,味 / 接客,,,',
  ].join('\n'))
})

test('buildResponsesCsv: 回答が 0 件ならヘッダーだけ', () => {
  assert.equal(buildResponsesCsv([V1], []), '回答日時,バージョン,満足度,良かった点,条件合致,Google 遷移日時')
})

test('buildResponsesCsv: カンマ・改行・引用符を含む値は引用符で囲み、引用符は 2 つ重ねる', () => {
  const csv = buildResponsesCsv([V2], [
    { createdAt: new Date('2026-10-08T01:00:00.000Z'), surveyVersion: 2, answers: { 'q-comment': '味, 量\n"最高"' }, isEligible: false, redirectedAt: null },
  ])
  assert.equal(csv, '回答日時,バージョン,総合満足度,ご感想,条件合致,Google 遷移日時\n2026-10-08T01:00:00.000Z,2,,"味, 量\n""最高""",,')
})

test('escapeCsvCell: 改行コード（\\r）も引用符で囲む', () => {
  assert.equal(escapeCsvCell('a\r\nb'), '"a\r\nb"')
  assert.equal(escapeCsvCell('ふつう'), 'ふつう')
})

test('escapeCsvCell: = + - @ で始まる値は先頭に \' を付け、数式として実行させない（Review Focus 5）', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("http://example.com")'), `"'=HYPERLINK(""http://example.com"")"`)
  assert.equal(escapeCsvCell('+81 90'), "'+81 90")
  assert.equal(escapeCsvCell('-1'), "'-1")
  assert.equal(escapeCsvCell('@SUM(A1)'), "'@SUM(A1)")
})
