// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // 管理画面・回答画面とも SPA で静的配信する（docs/README.md 前提 P-2）
  ssr: false,
  app: {
    head: {
      htmlAttrs: { lang: 'ja' },
    }
  },
  runtimeConfig: {
    public: {
      // false で Firebase に本接続する（既定はモック）。対象は認証・組織・メンバー（docs/superpowers/specs/2026-10-07-gbp-integration-design.md 3.1）
      useMock: process.env.NUXT_PUBLIC_USE_MOCK !== 'false',
      // true でクライアントを Firebase Emulator に接続する
      useEmulator: process.env.NUXT_PUBLIC_USE_EMULATOR === 'true',
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
})
