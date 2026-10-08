/**
 * JSON で表せるデータの深いコピー。
 * Vue のリアクティブ Proxy は structuredClone で複製できないため、こちらを使う。
 * Functions / Firestore とやり取りするデータは JSON 相当なので、この方式で足りる。
 */
export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
