import data from './municipalities.json'

// 順位計測の検索地点。国土数値情報「行政区域データ」（N03、CC BY 4.0）から作った市区町村の代表点（区域内の点）。
// 出典: 国土数値情報（行政区域データ）国土交通省 https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html
// 取得日: 2026-10-08。加工して作成（区域ごとの代表点の計算、都道府県名＋市区町村名の label の付与）。
// 生成: scripts/build-municipalities.mjs の冒頭を参照

export interface Municipality {
  /** 全国地方公共団体コード（5 桁） */
  code: string
  /** 例: 東京都渋谷区 */
  label: string
  lat: number
  lng: number
}

export const MUNICIPALITIES: Municipality[] = data as Municipality[]

/** 名前の一部で探す（空白は無視）。都道府県名から入力しても、市区町村名だけでも当たる */
export function searchMunicipalities(query: string, max = 20): Municipality[] {
  const text = query.replace(/\s+/g, '')
  if (text === '') return []
  return MUNICIPALITIES.filter(item => item.label.includes(text)).slice(0, max)
}

export function findMunicipalityByLabel(label: string): Municipality | null {
  return MUNICIPALITIES.find(item => item.label === label) ?? null
}

/** 店舗の座標から最も近い市区町村（座標が未設定の 0,0 なら null） */
export function nearestMunicipality(lat: number, lng: number): Municipality | null {
  if (lat === 0 && lng === 0) return null
  // 国内の近さを比べるだけなので、経度を緯度で補正した平面距離で十分
  const scale = Math.cos((lat * Math.PI) / 180)
  let nearest: Municipality | null = null
  let best = Number.POSITIVE_INFINITY
  for (const item of MUNICIPALITIES) {
    const distance = (item.lat - lat) ** 2 + ((item.lng - lng) * scale) ** 2
    // 同じ距離なら後ろ（区）を優先する。政令指定都市の本体は区より前に並ぶので、区の粒度で返る
    if (distance <= best) {
      best = distance
      nearest = item
    }
  }
  return nearest
}
