import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPasswordSetupUrl } from '../createAccount'

const FIREBASE_LINK = 'https://meo-tool.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=AbC-123_x%3D&apiKey=key&lang=ja'

test('toPasswordSetupUrl: oobCode を管理画面のパスワード設定ページに付け替える', () => {
  process.env.ADMIN_APP_URL = 'https://app.example.com/'
  assert.equal(toPasswordSetupUrl(FIREBASE_LINK), 'https://app.example.com/password-setup?oobCode=AbC-123_x%3D')
})

test('toPasswordSetupUrl: oobCode のないリンクはエラーにする', () => {
  process.env.ADMIN_APP_URL = 'https://app.example.com'
  assert.throws(() => toPasswordSetupUrl('https://meo-tool.firebaseapp.com/__/auth/action?mode=resetPassword'))
})
