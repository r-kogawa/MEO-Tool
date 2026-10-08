// GBP 投稿の上限値と画像の検証（サーバー・Storage ルールと値をそろえる）

export const MAX_POST_STORES = 20
export const POST_SUMMARY_MAX = 1500
export const POST_TITLE_MAX = 58
export const MAX_POST_IMAGE_BYTES = 5 * 1024 * 1024
export const POST_IMAGE_TYPES = ['image/jpeg', 'image/png']

/** 問題がなければ null */
export function validatePostImage(file: File): string | null {
  if (!POST_IMAGE_TYPES.includes(file.type)) return '画像は JPEG または PNG を選んでください。'
  if (file.size > MAX_POST_IMAGE_BYTES) return '画像は 5MB 以下にしてください。'
  return null
}
