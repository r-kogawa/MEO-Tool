import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https'

/** callable の呼び出し元へ返すエラーを投げる。メッセージは画面にそのまま表示される */
export function fail(code: FunctionsErrorCode, message: string): never {
  throw new HttpsError(code, message)
}
