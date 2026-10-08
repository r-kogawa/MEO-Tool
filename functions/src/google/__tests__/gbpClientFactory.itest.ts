import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { createFakeGoogle } from '../../__tests__/fakeGoogle'
import { GbpApiError, GbpAuthError } from '../../shared/gbp'
import { encryptSecret } from '../../shared/secrets'
import { createGbpClientForConnection, toGbpHttpsError, withConnectionErrors } from '../gbpClientFactory'
import { updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, { orgId: 'org-a', members: [{ uid: 'u-owner', role: 'owner' }] })
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ orgId: 'org-a', status: 'active', googleEmail: 'a@example.com', lastError: null })
  await db.doc('oauthTokens/c-1').set({ orgId: 'org-a', secret: await encryptSecret('refresh-ok') })
})

test('createGbpClientForConnection: 復号した refresh token でクライアントを作る', async () => {
  const fake = createFakeGoogle({ locationsByRefreshToken: { 'refresh-ok': { 'accounts/1': [{ name: 'locations/9', title: '本店' }] } } })
  const client = await createGbpClientForConnection(db, 'org-a', 'c-1', fake.deps)
  const locations = await client.listLocations('accounts/1', 'name,title')
  assert.equal(locations[0].title, '本店')
})

test('createGbpClientForConnection: 連携が active でなければ failed-precondition', async () => {
  await db.doc('organizations/org-a/googleConnections/c-1').update({ status: 'error' })
  await assert.rejects(createGbpClientForConnection(db, 'org-a', 'c-1', createFakeGoogle().deps), { code: 'failed-precondition' })
})

test('withConnectionErrors: GbpAuthError なら連携を error にして failed-precondition で投げ直す', async () => {
  await assert.rejects(
    withConnectionErrors(db, 'org-a', 'c-1', async () => { throw new GbpAuthError('invalid_grant', 'x') }),
    { code: 'failed-precondition', message: 'Google 連携の再認証が必要です。Google 連携の設定画面で再認証してください。' },
  )
  const connection = (await db.doc('organizations/org-a/googleConnections/c-1').get()).data()!
  assert.equal(connection.status, 'error')
  assert.equal(connection.lastError, 'Google の認証が切れました（invalid_grant）。再認証してください。')
})

test('toGbpHttpsError: 429 は resource-exhausted、その他の API エラーは unavailable、それ以外はそのまま', () => {
  assert.equal((toGbpHttpsError(new GbpApiError(429, 'RESOURCE_EXHAUSTED', 'q')) as { code: string }).code, 'resource-exhausted')
  const unavailable = toGbpHttpsError(new GbpApiError(400, 'INVALID_ARGUMENT', 'Invalid phone')) as { code: string; message: string }
  assert.equal(unavailable.code, 'unavailable')
  assert.match(unavailable.message, /Invalid phone/)
  const other = new Error('x')
  assert.equal(toGbpHttpsError(other), other)
})
