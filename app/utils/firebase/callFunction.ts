import { FirebaseError } from 'firebase/app'
import { httpsCallable, type Functions } from 'firebase/functions'

const FALLBACK_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。'
const TIMEOUT_MESSAGE = '応答に時間がかかっています。処理が続いている可能性があるため、しばらくしてから結果を確認してください。'

interface CallOptions {
  /** 画面側の待ち時間（ミリ秒）。既定は SDK の 70 秒。サーバーの timeoutSeconds より長い処理では、それ以上を渡す */
  timeoutMs?: number
}

/**
 * callable Functions を呼ぶ。HttpsError のメッセージ（日本語）をそのまま画面に出せる Error にして投げる。
 * 想定外のエラー（functions/internal など）は汎用メッセージにする。
 */
export async function callFunction<TReq, TRes>(functions: Functions, name: string, data: TReq, options: CallOptions = {}): Promise<TRes> {
  try {
    const result = await httpsCallable<TReq, TRes>(functions, name, options.timeoutMs ? { timeout: options.timeoutMs } : undefined)(data)
    return result.data
  }
  catch (error) {
    // internal は想定外の例外（サーバーの英語メッセージ）なので汎用文にする。unavailable は Google 側のエラー内容を含む（gbpClientFactory）
    if (error instanceof FirebaseError && error.code === 'functions/deadline-exceeded') throw new Error(TIMEOUT_MESSAGE, { cause: error })
    const isServerMessage = error instanceof FirebaseError && error.code !== 'functions/internal'
    // SDK がメッセージ末尾に付ける HTTP ステータス（例: " [400]"）は画面に出さない
    const message = isServerMessage ? error.message.replace(/\s*\[\d{3}\]$/, '') : FALLBACK_MESSAGE
    throw new Error(message, { cause: error })
  }
}
