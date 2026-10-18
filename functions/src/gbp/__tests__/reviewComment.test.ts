import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toOriginalComment } from '../reviews'

test('toOriginalComment: Google 翻訳付きの本文は原文だけを返す', () => {
  const comment = '(Translated by Google) Everything was smooth.\nIt\'s also cheap.\n\n(Original)\n対応も丁寧でした。\n安いしありがたいです！'
  assert.equal(toOriginalComment(comment), '対応も丁寧でした。\n安いしありがたいです！')
})

test('toOriginalComment: 翻訳の無い本文はそのまま返す', () => {
  assert.equal(toOriginalComment('とても良かった (Original) です'), 'とても良かった (Original) です')
})

test('toOriginalComment: 本文が無ければ null', () => {
  assert.equal(toOriginalComment(undefined), null)
})
