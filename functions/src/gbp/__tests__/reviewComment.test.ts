import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toOriginalComment } from '../reviews'

test('toOriginalComment: Google 翻訳付きの本文は原文だけを返す', () => {
  const comment = '(Translated by Google) Everything was smooth.\nIt\'s also cheap.\n\n(Original)\n対応も丁寧でした。\n安いしありがたいです！'
  assert.equal(toOriginalComment(comment), '対応も丁寧でした。\n安いしありがたいです！')
})

test('toOriginalComment: 原文が先・訳文が後の並びでも原文だけを返す', () => {
  const comment = '対応も丁寧でした。\n安いしありがたいです！\n\n(Translated by Google)\nEverything was smooth.\nIt\'s also cheap.'
  assert.equal(toOriginalComment(comment), '対応も丁寧でした。\n安いしありがたいです！')
})

test('toOriginalComment: 原文が先で (Original) の見出しが付いていても原文だけを返す', () => {
  const comment = '(Original)\n対応も丁寧でした。\n\n(Translated by Google)\nEverything was smooth.'
  assert.equal(toOriginalComment(comment), '対応も丁寧でした。')
})

test('toOriginalComment: 訳文が先で改行の数が違っても原文だけを返す', () => {
  assert.equal(toOriginalComment('(Translated by Google) Good.\n(Original)\n良かった'), '良かった')
})

test('toOriginalComment: 原文の無い訳文はそのまま返す', () => {
  assert.equal(toOriginalComment('(Translated by Google) Good.'), '(Translated by Google) Good.')
})

test('toOriginalComment: 翻訳の無い本文はそのまま返す', () => {
  assert.equal(toOriginalComment('とても良かった (Original) です'), 'とても良かった (Original) です')
})

test('toOriginalComment: 本文が無ければ null', () => {
  assert.equal(toOriginalComment(undefined), null)
})
