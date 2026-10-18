// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

// 本番の正規 URL（例: https://example.com）。OGP 画像・canonical・sitemap の絶対 URL に使う。末尾の / は除く
const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '')
const siteName = 'MEOツール'
const siteDescription = '口コミアンケート、Google ビジネスプロフィールの管理、マップ検索順位の計測をまとめて行える MEO ツール。お店の「見つけてもらう」を仕組みで増やします。'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // 管理画面・回答画面とも SPA で静的配信する（docs/README.md 前提 P-2）
  ssr: false,
  app: {
    // SPA のため、ここに書いた値だけが JS を実行しないクローラー（SNS のプレビューなど）に届く。全ページ共通の HTML に入る
    head: {
      htmlAttrs: { lang: 'ja' },
      meta: [
        { name: 'description', content: siteDescription },
        { property: 'og:site_name', content: siteName },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'ja_JP' },
        { property: 'og:title', content: `${siteName} | Google マップ集客をひとつの画面で` },
        { property: 'og:description', content: siteDescription },
        { property: 'og:image', content: `${siteUrl}/ogp.jpg` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '675' },
        { property: 'og:image:alt', content: 'MFF MEOツール' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
      ],
    }
  },
  runtimeConfig: {
    public: {
      siteUrl,
      // GA4 の測定 ID（G-XXXXXXX）。未設定ならアクセス解析を読み込まない
      gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
      slackChannelId: process.env.SLACK_CHANNEL_ID || '',
      slackPostUrl: process.env.SLACK_POST_MESSAGE_URL || '',
      // Firebase 設定
      FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || "",
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "",
      FIREBASE_MESSAGING_SENDER_ID:
        process.env.FIREBASE_MESSAGING_SENDER_ID || "",
      FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || "",
      FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || "",
      FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || "",
    }
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()]
  },
  nitro: {
    // robots.txt と sitemap.xml は server/routes で作り、generate 時に静的ファイルにする。
    // sitemap は絶対 URL が必須のため、SITE_URL が未設定のビルドでは出力しない
    prerender: {
      routes: siteUrl ? ['/robots.txt', '/sitemap.xml'] : ['/robots.txt'],
    },
  },
})
