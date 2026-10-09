import { DEMO_ACCOUNTS } from './seed'

const DEMO_UIDS: readonly string[] = DEMO_ACCOUNTS.map(account => account.uid)

/** デモアカウント（仮データで動く 3 人）の uid か */
export function isDemoUid(uid: string | null | undefined): uid is string {
  return typeof uid === 'string' && DEMO_UIDS.includes(uid)
}
