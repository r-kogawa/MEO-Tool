import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { KeyManagementServiceClient } from '@google-cloud/kms'
import { fail } from './errors'

// OAuth のクライアントシークレット・refresh token の暗号化。
// 本番は Cloud KMS（KMS_KEY_NAME）、Emulator とテストはローカル AES-256-GCM を使う。

export type CipherKind = 'kms' | 'local'

export interface EncryptedSecret {
  ciphertext: string
  cipher: CipherKind
  /** KMS で暗号化に使った鍵バージョン（ローテーションの追跡用） */
  keyVersion: string | null
}

interface SecretCipher {
  kind: CipherKind
  encrypt(plaintext: string): Promise<EncryptedSecret>
  decrypt(secret: EncryptedSecret): Promise<string>
}

/** Emulator・テスト専用の鍵。コードに固定されているため本番では使わない */
const LOCAL_KEY = createHash('sha256').update('meo-tool-local-dev-only').digest()
const IV_BYTES = 12
const TAG_BYTES = 16

const localCipher: SecretCipher = {
  kind: 'local',
  async encrypt(plaintext) {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', LOCAL_KEY, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'), cipher: 'local', keyVersion: null }
  },
  async decrypt(secret) {
    const bytes = Buffer.from(secret.ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', LOCAL_KEY, bytes.subarray(0, IV_BYTES))
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  },
}

function createKmsCipher(keyName: string): SecretCipher {
  const client = new KeyManagementServiceClient()
  return {
    kind: 'kms',
    async encrypt(plaintext) {
      const [response] = await client.encrypt({ name: keyName, plaintext: Buffer.from(plaintext, 'utf8') })
      return {
        ciphertext: Buffer.from(response.ciphertext as Uint8Array).toString('base64'),
        cipher: 'kms',
        keyVersion: response.name ?? null,
      }
    },
    async decrypt(secret) {
      const [response] = await client.decrypt({ name: keyName, ciphertext: Buffer.from(secret.ciphertext, 'base64') })
      return Buffer.from(response.plaintext as Uint8Array).toString('utf8')
    },
  }
}

let cached: SecretCipher | null = null

function isLocalAllowed(): boolean {
  return process.env.SECRET_CIPHER === 'local' || process.env.FUNCTIONS_EMULATOR === 'true'
}

function getCipher(): SecretCipher {
  if (cached) return cached
  if (isLocalAllowed()) return (cached = localCipher)
  const keyName = process.env.KMS_KEY_NAME
  if (!keyName) fail('failed-precondition', '暗号鍵（KMS_KEY_NAME）が設定されていません。運営にお問い合わせください。')
  return (cached = createKmsCipher(keyName))
}

export function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
  return Promise.resolve().then(() => getCipher().encrypt(plaintext))
}

export function decryptSecret(secret: EncryptedSecret): Promise<string> {
  return Promise.resolve().then(() => {
    const cipher = getCipher()
    if (secret.cipher !== cipher.kind) {
      fail('failed-precondition', '保存されている秘密の暗号方式が現在の設定と一致しません。運営にお問い合わせください。')
    }
    return cipher.decrypt(secret)
  })
}

/** テストで環境変数を切り替えたときに選択をやり直す */
export function resetSecretCipherForTest(): void {
  cached = null
}
