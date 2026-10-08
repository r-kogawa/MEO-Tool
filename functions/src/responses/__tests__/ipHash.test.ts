import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getIpHashSalt, hashIp } from '../ipHash'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('hashIp: SHA-256(ソルト:IP) の 16 進数。同じ入力で同じ値、ソルトや IP で値が変わる', () => {
  const hash = hashIp('salt-a', '203.0.113.1')
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hash, sha256('salt-a:203.0.113.1'))
  assert.equal(hash, hashIp('salt-a', '203.0.113.1'))
  assert.notEqual(hash, hashIp('salt-b', '203.0.113.1'))
  assert.notEqual(hash, hashIp('salt-a', '203.0.113.2'))
})

test('hashIp: IP がとれない場合は unknown をハッシュする', () => {
  assert.equal(hashIp('salt-a', null), sha256('salt-a:unknown'))
})

test('getIpHashSalt: 環境変数を使い、未設定なら Emulator は固定値・本番はエラー', () => {
  const saved = { salt: process.env.IP_HASH_SALT, emulator: process.env.FUNCTIONS_EMULATOR }
  const restore = (key: 'IP_HASH_SALT' | 'FUNCTIONS_EMULATOR', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    process.env.IP_HASH_SALT = 'from-env'
    assert.equal(getIpHashSalt(), 'from-env')
    delete process.env.IP_HASH_SALT
    process.env.FUNCTIONS_EMULATOR = 'true'
    assert.equal(getIpHashSalt(), 'meo-tool-local-ip-salt')
    delete process.env.FUNCTIONS_EMULATOR
    assert.throws(() => getIpHashSalt(), {
      code: 'failed-precondition',
      message: '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。',
    })
  }
  finally {
    restore('IP_HASH_SALT', saved.salt)
    restore('FUNCTIONS_EMULATOR', saved.emulator)
  }
})
