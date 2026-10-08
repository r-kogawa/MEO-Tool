import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSlug } from '../slug'

test('createSlug: 紛らわしい文字（0 1 l o）を含まない 10 文字で、毎回変わる', () => {
  const slugs = new Set(Array.from({ length: 200 }, () => createSlug()))
  assert.equal(slugs.size, 200)
  for (const slug of slugs) assert.match(slug, /^[a-km-np-z2-9]{10}$/)
})
