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

test('getIpHashSalt: 環境変数を使い、未設定ならデータも Emulator のときだけ固定値・それ以外はエラー', () => {
  type Key = 'IP_HASH_SALT' | 'FUNCTIONS_EMULATOR' | 'FIRESTORE_EMULATOR_HOST'
  const keys: Key[] = ['IP_HASH_SALT', 'FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<Key, string | undefined>
  const rejected = {
    code: 'failed-precondition',
    message: '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。',
  }
  try {
    process.env.IP_HASH_SALT = 'from-env'
    assert.equal(getIpHashSalt(), 'from-env')
    delete process.env.IP_HASH_SALT
    process.env.FUNCTIONS_EMULATOR = 'true'
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    assert.equal(getIpHashSalt(), 'meo-tool-local-ip-salt')
    // Functions だけ Emulator（データは本番）では固定ソルトを使わない
    delete process.env.FIRESTORE_EMULATOR_HOST
    assert.throws(() => getIpHashSalt(), rejected)
    delete process.env.FUNCTIONS_EMULATOR
    assert.throws(() => getIpHashSalt(), rejected)
  }
  finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})
