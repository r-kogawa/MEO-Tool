import { gmapsProvider } from '../providers/gmapsScraper'

// 手元から Google マップを実際に計測する。画面構造が変わったときの確認用。
// 使い方: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm --prefix functions run rank:probe -- "渋谷 カフェ" 35.664 139.698

async function main(): Promise<void> {
  const [keyword, lat, lng] = process.argv.slice(2)
  if (!keyword || !lat || !lng) {
    console.error('使い方: npm --prefix functions run rank:probe -- "<キーワード>" <緯度> <経度>')
    process.exit(1)
  }
  const startedAt = Date.now()
  const results = await gmapsProvider.search(keyword, { lat: Number(lat), lng: Number(lng) })
  console.table(results)
  console.log(`${results.length} 件 / ${Date.now() - startedAt} ms`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
