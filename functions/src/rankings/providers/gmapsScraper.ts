import chromium from '@sparticuz/chromium'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { RANK_LIMIT, parseGmapsItems } from './parseGmapsItems'
import type { RankResult } from '../types'
import { RankProviderError, type RankProvider, type RawGmapsItem } from './rankProvider'

// Google マップの検索結果を Headless Chrome で読む（2026-10-08 に画面構造を確認。仕様書 4.1）。
// headless の描画では一覧カードに口コミ件数が出ないことがある（2026-10-08 確認）。その場合 reviewCount は null になる
// 画面構造が変わったら、まず `npm --prefix functions run rank:probe` で実画面を確認する

const SEARCH_ZOOM = 14
const NAVIGATION_TIMEOUT_MS = 30_000
const RESULT_TIMEOUT_MS = 15_000
const LAUNCH_PROTOCOL_TIMEOUT_MS = 60_000
/**
 * search 全体の期限。ワーカーの timeoutSeconds（120 秒）より短くして、Cloud Tasks に強制終了される前に
 * 自分で timeout として終われるようにする（強制終了だと rankSearches が「計測中」のまま残る）
 */
export const SEARCH_DEADLINE_MS = 90_000
const SCROLL_WAIT_MS = 1_200
/** 件数が増えないスクロールがこの回数続いたら止める */
const MAX_IDLE_SCROLLS = 5
/** 広告を除いても 20 件残るよう、少し多めに読む */
const COLLECT_TARGET = RANK_LIMIT + 5

export function buildSearchUrl(keyword: string, at: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${at.lat},${at.lng},${SEARCH_ZOOM}z?hl=ja&gl=jp`
}

let browserPromise: Promise<Browser> | null = null

/** インスタンス内で Chromium を使い回す。CHROME_PATH があれば手元の Chrome を使う（rank:probe 用） */
function getBrowser(): Promise<Browser> {
  browserPromise ??= (async () => {
    const localChrome = process.env.CHROME_PATH
    const browser = await puppeteer.launch({
      executablePath: localChrome ?? await chromium.executablePath(),
      args: localChrome ? ['--lang=ja-JP'] : [...chromium.args, '--lang=ja-JP'],
      headless: localChrome ? true : 'shell',
      defaultViewport: { width: 1280, height: 900 },
      protocolTimeout: LAUNCH_PROTOCOL_TIMEOUT_MS,
    })
    browser.on('disconnected', () => { browserPromise = null })
    return browser
  })().catch((error: unknown) => {
    browserPromise = null
    throw error
  })
  return browserPromise
}

function assertNotBlocked(url: string): void {
  if (url.includes('/sorry/') || url.includes('consent.google.com')) throw new RankProviderError('blocked', `ブロックされました: ${url}`)
}

/** 一覧（feed）・店舗ページへの直接移動（1 件だけ）・結果なし のどれになったか */
async function waitForResultState(page: Page): Promise<'feed' | 'place' | 'none'> {
  const handle = await page.waitForFunction(() => {
    if (document.querySelector('div[role="feed"]')) return 'feed'
    if (location.pathname.includes('/maps/place/') && document.querySelector('h1')) return 'place'
    if (/が見つかりません/.test(document.body?.innerText ?? '')) return 'none'
    return false
  }, { timeout: RESULT_TIMEOUT_MS, polling: 500 })
  assertNotBlocked(page.url())
  return await handle.jsonValue() as 'feed' | 'place' | 'none'
}

/** ブラウザ内で実行する。外側の変数は使えない */
function collectFeedItems(): RawGmapsItem[] {
  const feed = document.querySelector('div[role="feed"]')
  if (!feed) return []
  return [...feed.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]')].map((anchor) => {
    const card = (anchor.closest('div[jsaction]')?.parentElement ?? anchor.parentElement) as HTMLElement | null
    const text = card?.innerText ?? ''
    return {
      name: anchor.getAttribute('aria-label') ?? '',
      href: anchor.href,
      starLabel: card?.querySelector('span[role="img"][aria-label]')?.getAttribute('aria-label') ?? null,
      text,
      isSponsored: /スポンサー/.test(text),
    }
  })
}

async function scrollAndCollect(page: Page): Promise<RawGmapsItem[]> {
  let idle = 0
  let lastCount = 0
  while (idle < MAX_IDLE_SCROLLS) {
    const { count, isEnd } = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]')
      if (!feed) return { count: 0, isEnd: true }
      feed.scrollBy(0, feed.scrollHeight)
      return {
        count: feed.querySelectorAll('a[href*="/maps/place/"]').length,
        isEnd: (feed as HTMLElement).innerText.includes('リストの最後に到達しました'),
      }
    })
    if (count >= COLLECT_TARGET || isEnd) break
    idle = count > lastCount ? 0 : idle + 1
    lastCount = count
    await new Promise(resolve => setTimeout(resolve, SCROLL_WAIT_MS))
  }
  return page.evaluate(collectFeedItems)
}

/** 結果が 1 件だけで店舗ページに直接移動したとき */
async function readPlacePage(page: Page): Promise<RawGmapsItem> {
  return page.evaluate(() => ({
    name: document.querySelector('h1')?.textContent?.trim() ?? '',
    href: location.href,
    starLabel: document.querySelector('div[role="main"] span[role="img"][aria-label*="つ星"]')?.getAttribute('aria-label') ?? null,
    text: '',
    isSponsored: false,
  }))
}

async function searchOnce(keyword: string, at: { lat: number; lng: number }): Promise<RankResult[]> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' })
    await page.goto(buildSearchUrl(keyword, at), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    assertNotBlocked(page.url())
    const state = await waitForResultState(page)
    if (state === 'none') return []
    if (state === 'place') return parseGmapsItems([await readPlacePage(page)])
    return parseGmapsItems(await scrollAndCollect(page))
  }
  catch (error) {
    if (error instanceof RankProviderError) throw error
    assertNotBlocked(page.url())
    if (error instanceof Error && error.name === 'TimeoutError') throw new RankProviderError('timeout', error.message)
    throw new RankProviderError('parse', String(error))
  }
  finally {
    await page.close().catch(() => undefined)
  }
}

/** 期限を過ぎたら timeout にする。タイマーは必ず解除する */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RankProviderError('timeout', `${ms}ms の期限を過ぎました`)), ms)
  })
  // 期限切れの後で work が失敗しても、未処理の rejection にしない
  work.catch(() => undefined)
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

export const gmapsProvider: RankProvider = {
  search: (keyword, at) => withDeadline(searchOnce(keyword, at), SEARCH_DEADLINE_MS),
}
