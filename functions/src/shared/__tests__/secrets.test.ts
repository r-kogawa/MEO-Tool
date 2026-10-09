import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { decryptSecret, encryptSecret, resetSecretCipherForTest } from '../secrets'

const original = { ...process.env }

beforeEach(() => {
  resetSecretCipherForTest()
  delete process.env.FUNCTIONS_EMULATOR
  delete process.env.FIRESTORE_EMULATOR_HOST
  delete process.env.KMS_KEY_NAME
  process.env.SECRET_CIPHER = 'local'
})

afterEach(() => {
  process.env = { ...original }
  resetSecretCipherForTest()
})

test('ローカル暗号: 暗号化して復号すると元に戻り、暗号文に平文を含まない', async () => {
  const secret = await encryptSecret('refresh-token-123')

  assert.equal(secret.cipher, 'local')
  assert.ok(!secret.ciphertext.includes('refresh-token-123'))
  assert.equal(await decryptSecret(secret), 'refresh-token-123')
})

test('ローカル暗号: 同じ平文でも毎回違う暗号文になる', async () => {
  const a = await encryptSecret('same')
  const b = await encryptSecret('same')
  assert.notEqual(a.ciphertext, b.ciphertext)
})

test('ローカル暗号: 改ざんされた暗号文は復号に失敗する', async () => {
  const secret = await encryptSecret('value')
  const bytes = Buffer.from(secret.ciphertext, 'base64')
  bytes[bytes.length - 1] ^= 0xff
  await assert.rejects(decryptSecret({ ...secret, ciphertext: bytes.toString('base64') }))
})

test('本番設定（local 指定なし・Emulator 外）で KMS_KEY_NAME が無ければ failed-precondition', async () => {
  delete process.env.SECRET_CIPHER
  await assert.rejects(encryptSecret('x'), { code: 'failed-precondition' })
})

test('本番設定ではローカル暗号の秘密を復号しない（設定ミスの検知）', async () => {
  const secret = await encryptSecret('x')
  delete process.env.SECRET_CIPHER
  process.env.KMS_KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k'
  resetSecretCipherForTest()
  await assert.rejects(decryptSecret(secret), { code: 'failed-precondition' })
})

test('Functions Emulator だけ（データは本番）ではローカル暗号を使わず、KMS_KEY_NAME が無ければ failed-precondition', async () => {
  delete process.env.SECRET_CIPHER
  process.env.FUNCTIONS_EMULATOR = 'true'
  await assert.rejects(encryptSecret('x'), { code: 'failed-precondition' })
})

test('Functions と Firestore の両方が Emulator ならローカル暗号を使う', async () => {
  delete process.env.SECRET_CIPHER
  process.env.FUNCTIONS_EMULATOR = 'true'
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  const secret = await encryptSecret('x')
  assert.equal(await decryptSecret(secret), 'x')
})
