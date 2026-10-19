import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { nextOperatorClaims } from '../operatorClaims'

// 運営者（Custom Claims の operator）の付与・剥奪。本番の Auth / Firestore に書き込む（デプロイ対象外）
// 使い方: npm --prefix functions run ops:grant -- <email> [--revoke]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const email = args.find(arg => !arg.startsWith('--'))
  const isRevoke = args.includes('--revoke')
  if (!email) {
    console.error('使い方: npm --prefix functions run ops:grant -- <email> [--revoke]')
    process.exit(1)
  }
  // lib-test/ops/__tests__/ から functions/serviceAccount.json を読む
  const serviceAccount = require('../../../serviceAccount.json')
  initializeApp({ credential: cert(serviceAccount as ServiceAccount) })
  const auth = getAuth()
  const user = await auth.getUserByEmail(email)
  await auth.setCustomUserClaims(user.uid, nextOperatorClaims(user.customClaims, isRevoke))
  // platformRole は表示用の写し。判定は claims で行う
  await getFirestore().doc(`users/${user.uid}`).set({ platformRole: isRevoke ? null : 'operator' }, { merge: true })
  if (isRevoke) await auth.revokeRefreshTokens(user.uid)
  console.log(`${email}（${user.uid}）の運営権限を${isRevoke ? '外しました。既存のログインも無効にしました' : '付けました'}。`)
  console.log('対象者は一度ログアウトして、ログインし直してください（権限は ID トークンの再取得で反映されます）。')
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
