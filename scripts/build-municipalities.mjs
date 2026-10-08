// 市区町村の選択欄用 JSON を作る。
// データ: 国土数値情報「行政区域データ」（N03）。出典: 国土数値情報（行政区域データ）国土交通省
// 許諾: CC BY 4.0（商用可）
// 入手: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html （N03-20250101_GML.zip）、取得日 2026-10-08
// 加工して作成: 区域ごとに「区域内に必ず入る代表点」を計算し、都道府県名＋市区町村名の label を付けた（本スクリプトと mapshaper）。
//
// 使い方（ZIP はリポジトリ外の空ディレクトリに展開し、そのディレクトリの中ではコマンドを実行しない）:
//   1. npx --yes mapshaper -i <展開先>/N03-20250101.geojson -dissolve N03_007 copy-fields=N03_001,N03_004,N03_005 -points inner -o format=geojson <作業先>/points.json
//   2. node scripts/build-municipalities.mjs <作業先>/points.json > app/utils/geo/municipalities.json
// 属性名はデータの版で変わりうる。下の定数は、1 件目の properties を見て確かめてから使う。
import { readFileSync } from 'node:fs'

/** 北方領土（行政区域コードはあるが実態がないため除く） */
const EXCLUDED_CODES = new Set(['01695', '01696', '01697', '01698', '01699', '01700'])

/** 都道府県名 */
const PREFECTURE = 'N03_001'
/** 市区町村名（政令指定都市は「札幌市」、東京の特別区は「渋谷区」。郡名は N03_003 にあり使わない） */
const NAME = 'N03_004'
/** 政令指定都市の区名（例: 中央区。それ以外は空） */
const WARD = 'N03_005'
/** 行政区域コード（5 桁） */
const CODE = 'N03_007'

const [, , input] = process.argv
if (!input) {
  console.error('使い方: node scripts/build-municipalities.mjs <points.json>')
  process.exit(1)
}

const round = value => Math.round(value * 10000) / 10000
const text = value => (value == null ? '' : String(value).trim())
const features = JSON.parse(readFileSync(input, 'utf8')).features

for (const key of [PREFECTURE, NAME, WARD, CODE]) {
  if (!(key in features[0].properties)) {
    console.error(`属性 ${key} がありません。1 件目の properties: ${JSON.stringify(features[0].properties)}`)
    process.exit(1)
  }
}

const byCode = new Map()
/** 政令指定都市 → 所属する区の点 */
const wardsByCity = new Map()

for (const feature of features) {
  const props = feature.properties
  const code = text(props[CODE]).padStart(5, '0')
  const name = text(props[NAME])
  if (!/^\d{5}$/.test(code) || code === '00000' || name === '' || name === '所属未定地' || byCode.has(code) || EXCLUDED_CODES.has(code)) continue
  const city = name
  const ward = text(props[WARD])
  const prefecture = text(props[PREFECTURE])
  const [lng, lat] = feature.geometry.coordinates
  const point = { lat: round(lat), lng: round(lng) }
  // 郡名は含めない。政令指定都市の区は「市名 + 区名」にする
  byCode.set(code, { code, label: `${prefecture}${city}${ward}`, ...point })
  if (ward !== '') {
    const key = `${prefecture}${city}`
    wardsByCity.set(key, [...(wardsByCity.get(key) ?? []), { code, ...point }])
  }
}

// 政令指定都市そのもの。コードは最小の区コードを 100 単位に切り下げたもの（大阪市 27100）で、
// 既に使われていれば 10 単位（川崎市 14130、堺市 27140、浜松市 22130、福岡市 40130 など）。
// 点は、区の点の平均に最も近い区の点（平均そのものは区域外になりうるため）。
const cities = [...wardsByCity].sort(([, a], [, b]) => a[0].code.localeCompare(b[0].code))
for (const [label, wards] of cities) {
  const first = Math.min(...wards.map(ward => Number(ward.code)))
  const floorTo = unit => String(Math.floor(first / unit) * unit).padStart(5, '0')
  const code = byCode.has(floorTo(100)) ? floorTo(10) : floorTo(100)
  if (byCode.has(code)) {
    console.error(`コード ${code} が重複するため ${label} を除きます`)
    continue
  }
  const mean = {
    lat: wards.reduce((sum, ward) => sum + ward.lat, 0) / wards.length,
    lng: wards.reduce((sum, ward) => sum + ward.lng, 0) / wards.length,
  }
  const distance = ward => (ward.lat - mean.lat) ** 2 + (ward.lng - mean.lng) ** 2
  const nearest = wards.reduce((best, ward) => (distance(ward) < distance(best) ? ward : best))
  byCode.set(code, { code, label, lat: nearest.lat, lng: nearest.lng })
}

const municipalities = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
process.stdout.write(`${JSON.stringify(municipalities)}\n`)
console.error(`${municipalities.length} 件`)
