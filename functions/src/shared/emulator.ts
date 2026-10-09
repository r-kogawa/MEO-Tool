/**
 * Functions も Firestore も Emulator で動いているか（＝データも偽物）。
 * Functions だけを Emulator で動かす構成（npm --prefix functions run serve）では本番の Firestore を読み書きするため、
 * ローカル用の暗号やソルトを使うと本番のデータと食い違う。その判定に使う。
 */
export function isFullyEmulated(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === 'true' && !!env.FIRESTORE_EMULATOR_HOST
}
