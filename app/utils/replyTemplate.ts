// 口コミ返信の差し込み。プレビューと送信内容を一致させるため、クライアントで展開してから送る。

export const REPLY_PLACEHOLDERS = ['{投稿者名}', '{店舗名}'] as const
export const MAX_REPLY_BYTES = 4096

export function expandReplyTemplate(body: string, values: { reviewerName: string; storeName: string }): string {
  return body.replaceAll('{投稿者名}', values.reviewerName).replaceAll('{店舗名}', values.storeName).trim()
}

/** GBP の返信上限はバイト数（UTF-8）で決まる */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
