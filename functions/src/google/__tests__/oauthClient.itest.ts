import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { caller, clearFirestore, getTestDb, seedOrg } from '../../__tests__/emulator'
import { deleteGoogleOAuthClientFunc, getGoogleOAuthConfigFunc, loadOAuthClient, updateGoogleOAuthClientFunc } from '../oauthClient'

const db = getTestDb()
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com'

beforeEach(async () => {
  await clearFirestore()
  process.env.OAUTH_CALLBACK_URL = 'https://example.test/googleOAuthCallback'
  await seedOrg(db, {
    orgId: 'org-a',
    members: [{ uid: 'u-owner', role: 'owner' }, { uid: 'u-admin', role: 'admin' }],
  })
})

test('updateGoogleOAuthClient: owner が登録すると、シークレットは暗号化して全拒否コレクションに保存する', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: ` ${CLIENT_ID} `, clientSecret: 'GOCSPX-secret' })

  const org = (await db.doc('organizations/org-a').get()).data()!
  assert.equal(org.googleOAuthClient.clientId, CLIENT_ID)
  assert.equal(org.googleOAuthClient.configuredBy, 'u-owner')
  const saved = (await db.doc('oauthClientSecrets/org-a').get()).data()!
  assert.ok(!JSON.stringify(saved).includes('GOCSPX-secret'))
  assert.deepEqual(await loadOAuthClient(db, 'org-a'), { clientId: CLIENT_ID, clientSecret: 'GOCSPX-secret' })
})

test('updateGoogleOAuthClient: admin は不可、クライアント ID の形式違いは invalid-argument', async () => {
  await assert.rejects(
    updateGoogleOAuthClientFunc(db, caller('u-admin'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 's' }),
    { code: 'permission-denied' },
  )
  await assert.rejects(
    updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: 'not-a-client-id', clientSecret: 's' }),
    { code: 'invalid-argument', message: 'クライアント ID の形式が正しくありません（末尾が .apps.googleusercontent.com）。' },
  )
})

test('loadOAuthClient: 未登録なら failed-precondition', async () => {
  await assert.rejects(loadOAuthClient(db, 'org-a'), {
    code: 'failed-precondition',
    message: 'Google OAuth クライアントが登録されていません。Google 連携の設定画面で登録してください。',
  })
})

test('deleteGoogleOAuthClient: 有効な連携が残っていれば拒否し、無ければ削除する', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 's' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ status: 'active', googleEmail: 'a@example.com' })

  await assert.rejects(
    deleteGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a' }),
    { code: 'failed-precondition', message: '連携中の Google アカウントがあります。先に連携を解除してください。' },
  )

  await db.doc('organizations/org-a/googleConnections/c-1').update({ status: 'revoked' })
  await deleteGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a' })

  assert.equal((await db.doc('organizations/org-a').get()).get('googleOAuthClient'), null)
  assert.equal((await db.doc('oauthClientSecrets/org-a').get()).exists, false)
})

test('getGoogleOAuthConfig: owner / admin にコールバック URL を返す。未設定なら failed-precondition', async () => {
  assert.deepEqual(await getGoogleOAuthConfigFunc(db, caller('u-admin'), { orgId: 'org-a' }), { callbackUrl: 'https://example.test/googleOAuthCallback' })
  delete process.env.OAUTH_CALLBACK_URL
  await assert.rejects(getGoogleOAuthConfigFunc(db, caller('u-owner'), { orgId: 'org-a' }), { code: 'failed-precondition' })
})

test('updateGoogleOAuthClient: 連携が残っている間はクライアント ID を変更できない（シークレットだけの更新は可）', async () => {
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 'old' })
  await db.doc('organizations/org-a/googleConnections/c-1').set({ status: 'error', googleEmail: 'a@example.com' })

  await assert.rejects(
    updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: '999-other.apps.googleusercontent.com', clientSecret: 's' }),
    { code: 'failed-precondition', message: '連携中の Google アカウントがあるため、クライアント ID は変更できません。先に連携を解除してください。' },
  )
  await updateGoogleOAuthClientFunc(db, caller('u-owner'), { orgId: 'org-a', clientId: CLIENT_ID, clientSecret: 'new' })
  assert.equal((await loadOAuthClient(db, 'org-a')).clientSecret, 'new')
})
