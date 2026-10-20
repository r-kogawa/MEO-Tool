import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asObject, requireEmail, requireId, requireOneOf, requirePhone, requireString, requireStringArray } from '../validation'

const invalid = { code: 'invalid-argument' }

test('asObject: オブジェクト以外は invalid-argument', () => {
  assert.deepEqual(asObject({ a: 1 }), { a: 1 })
  for (const value of [null, undefined, 'x', 1, []]) assert.throws(() => asObject(value), invalid)
})

test('requireString: 前後の空白を除き、空・型違い・長すぎは invalid-argument', () => {
  assert.equal(requireString('  ハナミ  ', '組織名'), 'ハナミ')
  assert.throws(() => requireString('   ', '組織名'), { code: 'invalid-argument', message: '組織名を入力してください。' })
  assert.throws(() => requireString(1, '組織名'), invalid)
  assert.throws(() => requireString('a'.repeat(11), '組織名', 10), { message: '組織名は 10 文字以内にしてください。' })
})

test('requireId: 英数字・ハイフン・アンダースコアのみ', () => {
  assert.equal(requireId('org-abc_1', '組織 ID'), 'org-abc_1')
  assert.throws(() => requireId('org/../x', '組織 ID'), invalid)
})

test('requireOneOf: 選択肢にない値は invalid-argument', () => {
  assert.equal(requireOneOf('admin', ['admin', 'staff'] as const, '権限'), 'admin')
  assert.throws(() => requireOneOf('owner', ['admin', 'staff'] as const, '権限'), invalid)
})

test('requireStringArray: 重複を除き、空文字・型違い・件数超過は invalid-argument', () => {
  assert.deepEqual(requireStringArray(['a', 'b', 'a'], '担当店舗'), ['a', 'b'])
  assert.throws(() => requireStringArray(['a', ''], '担当店舗'), invalid)
  assert.throws(() => requireStringArray('a', '担当店舗'), invalid)
  assert.throws(() => requireStringArray(['a', 'b', 'c'], '担当店舗', 2), invalid)
})

test('requireEmail: 小文字化し、形式違いは invalid-argument', () => {
  assert.equal(requireEmail(' Tanaka@Example.COM '), 'tanaka@example.com')
  assert.throws(() => requireEmail('tanaka'), { code: 'invalid-argument', message: 'メールアドレスの形式が正しくありません。' })
})

test('requirePhone: 全角・ハイフン・括弧・空白を除いて数字だけにする', () => {
  assert.equal(requirePhone('090-1234-5678'), '09012345678')
  assert.equal(requirePhone('０３（１２３４）５６７８'), '0312345678')
  assert.equal(requirePhone(' 03 1234 5678 '), '0312345678')
  assert.equal(requirePhone('090ー1234ー5678'), '09012345678')
})

test('requirePhone: 0 始まり 10〜11 桁以外は invalid-argument', () => {
  const message = '電話番号の形式が正しくありません。'
  for (const value of ['031234567', '090123456789', '9012345678', '+81 90-1234-5678', '090-1234-567a']) {
    assert.throws(() => requirePhone(value), { code: 'invalid-argument', message })
  }
  assert.throws(() => requirePhone(''), { message: '電話番号を入力してください。' })
  assert.throws(() => requirePhone(9012345678), invalid)
})
