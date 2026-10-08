import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { decryptSecret } from '../../shared/secrets'
import { createGoogleAuthUrlFunc, deleteGoogleConnectionFunc, handleGoogleOAuthCallback } from '../connect'
import { updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com'
const APP = 'https://app.example.test'

beforeEach(async () => {
  await clearFirestore()
  process.env.OAUTH_CALLBACK_URL = 'https://fn.example.test/googleOAuthCallback'
  process.env.ADMIN_APP_URL = APP
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-staff', role: 'staff', storeIds: ['st-1'] }],
  })
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 'secret-a' })
})

async function startAuth(): Promise<string> {
  const { url } = await createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-a' })
  return new URL(url).searchParams.get('state')!
}

test('createGoogleAuthUrl: 組織のクライアント ID・オフライン・同意画面・スコープを付け、state を保存する', async () => {
  const { url } = await createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-a' })
  const parsed = new URL(url)

  assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(parsed.searchParams.get('client_id'), CLIENT_ID)
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://fn.example.test/googleOAuthCallback')
  assert.equal(parsed.searchParams.get('access_type'), 'offline')
  assert.equal(parsed.searchParams.get('prompt'), 'consent')
  assert.match(parsed.searchParams.get('scope')!, /business\.manage/)
  const state = (await db.doc(`oauthStates/${parsed.searchParams.get('state')}`).get()).data()!
  assert.equal(state.orgId, 'org-a')
  assert.equal(state.uid, 'u-owner')
})

test('createGoogleAuthUrl: staff は不可、OAuth クライアント未登録は failed-precondition', async () => {
  await assert.rejects(createGoogleAuthUrlFunc(db, caller('u-staff'), { orgId: 'org-a' }), { code: 'permission-denied' })
  await seedOrg(db, { orgId: 'org-b', members: [{ uid: 'u-owner', role: 'owner' }] })
  await assert.rejects(createGoogleAuthUrlFunc(db, caller('u-owner'), { orgId: 'org-b' }), { code: 'failed-precondition' })
})

test('callback: コードを交換し、refresh token を暗号化保存して連携を作り、設定画面へ戻す', async () => {
  const state = await startAuth()
  const fake = createFakeGoogle()

  const redirect = await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  assert.equal(redirect, `${APP}/admin/org-a/settings/google?connected=1`)
  const connections = await db.collection('organizations/org-a/googleConnections').get()
  assert.equal(connections.size, 1)
  const connection = connections.docs[0].data()
  assert.equal(connection.googleEmail, 'shop@example.com')
  assert.equal(connection.status, 'active')
  assert.deepEqual(connection.gbpAccounts, [{ name: 'accounts/100', accountName: 'ハナミ食堂', type: null }])
  const token = (await db.doc(`oauthTokens/${connections.docs[0].id}`).get()).data()!
  assert.equal(await decryptSecret(token.secret), 'refresh-1')
  assert.equal((await db.doc(`oauthStates/${state}`).get()).exists, false)
  assert.equal((fake.calls.exchangeInputs[0] as { clientSecret: string }).clientSecret, 'secret-a')
})

test('callback: 同じ state は 2 回使えない（連携は 1 つだけ）', async () => {
  const state = await startAuth()
  const fake = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  const second = await handleGoogleOAuthCallback(db, { code: 'code-1', state }, fake.deps)

  assert.equal(second, `${APP}/orgs?googleError=invalid_state`)
  assert.equal((await db.collection('organizations/org-a/googleConnections').get()).size, 1)
  assert.equal(fake.calls.exchange, 1)
})

test('callback: 期限切れ・存在しない state は invalid_state', async () => {
  const state = await startAuth()
  await db.doc(`oauthStates/${state}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
  const fake = createFakeGoogle()

  assert.equal(await handleGoogleOAuthCallback(db, { code: 'c', state }, fake.deps), `${APP}/orgs?googleError=invalid_state`)
  assert.equal(await handleGoogleOAuthCallback(db, { code: 'c', state: 'unknown' }, fake.deps), `${APP}/orgs?googleError=invalid_state`)
  assert.equal(fake.calls.exchange, 0)
})

test('callback: 同意拒否・refresh token なし・交換失敗はエラーコード付きで戻し、連携を作らない', async () => {
  const base = `${APP}/admin/org-a/settings/google?error=`
  assert.equal(await handleGoogleOAuthCallback(db, { error: 'access_denied', state: await startAuth() }, createFakeGoogle().deps), `${base}access_denied`)
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ tokens: { refreshToken: null, accessToken: 'a', googleEmail: 'x@example.com' } }).deps),
    `${base}no_refresh_token`,
  )
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ exchangeError: Object.assign(new Error('invalid_client'), { response: { data: { error: 'invalid_client' } } }) }).deps),
    `${base}invalid_client`,
  )
  assert.equal(
    await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, createFakeGoogle({ exchangeError: new Error('boom') }).deps),
    `${base}exchange_failed`,
  )
  assert.equal((await db.collection('organizations/org-a/googleConnections').get()).size, 0)
})

test('callback: 同じ Google アカウントで連携し直すと既存の連携を更新する（再認証）', async () => {
  const first = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'c1', state: await startAuth() }, first.deps)
  const [existing] = (await db.collection('organizations/org-a/googleConnections').get()).docs
  await existing.ref.update({ status: 'error', lastError: '再認証が必要です' })

  const second = createFakeGoogle({ tokens: { refreshToken: 'refresh-2', accessToken: 'a2', googleEmail: 'shop@example.com' } })
  await handleGoogleOAuthCallback(db, { code: 'c2', state: await startAuth() }, second.deps)

  const connections = await db.collection('organizations/org-a/googleConnections').get()
  assert.equal(connections.size, 1)
  assert.equal(connections.docs[0].get('status'), 'active')
  assert.equal(connections.docs[0].get('lastError'), null)
  assert.equal(await decryptSecret((await db.doc(`oauthTokens/${existing.id}`).get()).get('secret')), 'refresh-2')
})

test('deleteGoogleConnection: Google 側を取り消し、トークンを削除して revoked にする', async () => {
  const fake = createFakeGoogle()
  await handleGoogleOAuthCallback(db, { code: 'c1', state: await startAuth() }, fake.deps)
  const [connection] = (await db.collection('organizations/org-a/googleConnections').get()).docs

  await deleteGoogleConnectionFunc(db, caller('u-owner'), { orgId: 'org-a', connectionId: connection.id }, fake.deps)

  assert.deepEqual(fake.calls.revoked, ['refresh-1'])
  assert.equal((await db.doc(`oauthTokens/${connection.id}`).get()).exists, false)
  assert.equal((await connection.ref.get()).get('status'), 'revoked')
  await assert.rejects(
    deleteGoogleConnectionFunc(db, caller('u-staff'), { orgId: 'org-a', connectionId: connection.id }, fake.deps),
    { code: 'permission-denied' },
  )
})

test('callback: 保存（Firestore・暗号化など）に失敗したら save_failed で設定画面に戻し、連携を作らない', async () => {
  // Firestore が受け付けない値（undefined）を含むアカウントで、保存のトランザクションだけを失敗させる
  const fake = createFakeGoogle({ accounts: [{ name: undefined as unknown as string }] })

  const redirect = await handleGoogleOAuthCallback(db, { code: 'c', state: await startAuth() }, fake.deps)

  assert.equal(redirect, `${APP}/admin/org-a/settings/google?error=save_failed`)
  assert.equal((await db.collection('organizations/org-a/googleConnections').get()).size, 0)
})
