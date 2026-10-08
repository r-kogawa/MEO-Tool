import type { RankErrorCode, RankResult } from '../types'

// 順位の取得元。Google マップのスクレイピング（gmapsScraper）を、後で SERP API などに差し替えられるようにする

/** 画面から抜き出した 1 件分の生データ。解析は parseGmapsItems が行う */
export interface RawGmapsItem {
  /** a[href*="/maps/place/"] の aria-label */
  name: string
  href: string
  /** span[role="img"] の aria-label（例: 「4.1 つ星 クチコミ 195 件」）。評価がない店舗は null */
  starLabel: string | null
  /** 店舗カードの innerText（改行区切り） */
  text: string
  isSponsored: boolean
}

export interface RankProvider {
  /** 上位 20 件を順位順に返す。結果が 0 件なら空配列 */
  search(keyword: string, at: { lat: number; lng: number }): Promise<RankResult[]>
}

export class RankProviderError extends Error {
  constructor(public readonly code: RankErrorCode, message: string) {
    super(message)
    this.name = 'RankProviderError'
  }
}
