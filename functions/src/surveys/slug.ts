import { randomBytes } from 'node:crypto'

// 回答画面の URL（/s/{slug}）に使う推測されにくい文字列。紛らわしい 0 1 l o を除いた 32 文字から選ぶ（256 を割り切るので偏らない）

const SLUG_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'
const SLUG_LENGTH = 10

export function createSlug(): string {
  return Array.from(randomBytes(SLUG_LENGTH), byte => SLUG_CHARS[byte % SLUG_CHARS.length]).join('')
}
