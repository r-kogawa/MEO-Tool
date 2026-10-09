import { createHash } from 'node:crypto'
import { fail } from '../shared/errors'
import { isFullyEmulated } from '../shared/emulator'

// 回答者の接続元は IP そのものを保存せず、ソルト付きのハッシュだけを使う（レート制限と回答の ipHash）

/** データも Emulator のとき・テスト専用。コードに固定されているため本番では使わない */
const EMULATOR_SALT = 'meo-tool-local-ip-salt'

/** SHA-256(ソルト + ':' + IP) の 16 進数。IP がとれない場合は 'unknown' をハッシュする */
export function hashIp(salt: string, ip: string | null): string {
  return createHash('sha256').update(`${salt}:${ip ?? 'unknown'}`).digest('hex')
}

/** IP_HASH_SALT（環境変数）。未設定ならデータも Emulator のときだけ固定値、それ以外は受け付けない（secrets.ts の判定に合わせる） */
export function getIpHashSalt(): string {
  const salt = process.env.IP_HASH_SALT
  if (salt) return salt
  if (isFullyEmulated()) return EMULATOR_SALT
  return fail('failed-precondition', '現在このアンケートは回答を受け付けられません。運営にお問い合わせください。')
}
