import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearFirestore, getTestDb } from '../../__tests__/emulator'
import { createAccountFunc, type AccountAuth } from '../createAccount'

const db = getTestDb()
const input = { requestId: 'req12345678', email: ' Tanaka@Example.com ', type: 'corporate', orgName: 'ハナミ食堂', displayName: '田中' }

/** uid → メールアドレスで Auth ユーザーを持つ偽物 */
function fakeAuth(users = new Map<string, string>()): AccountAuth & { users: Map<string, string> } {
  return {
    users,
    async getUserEmail(uid) {
      return users.get(uid) ?? null
    },
    async createUser(uid, email) {
      if (users.has(uid)) return 'uid-exists'
      if ([...users.values()].includes(email)) return 'email-exists'
      users.set(uid, email)
      return 'created'
    },
    async createPasswordSetupLink(email) {
      return `https://example.com/reset?email=${email}`
    },
  }
}

beforeEach(() => clearFirestore())

test('Auth ユーザー・組織・owner メンバーを作り、パスワード設定リンクを返す', async () => {
  const auth = fakeAuth()
  const result = await createAccountFunc(db, input, auth)

  assert.deepEqual(result, {
    uid: 'ext-req12345678',
    orgId: 'org-ext-req12345678',
    passwordSetupLink: 'https://example.com/reset?email=tanaka@example.com',
  })
  assert.equal(auth.users.get('ext-req12345678'), 'tanaka@example.com')
  const org = (await db.doc('organizations/org-ext-req12345678').get()).data()!
  assert.equal(org.ownerUid, 'ext-req12345678')
  assert.equal(org.type, 'corporate')
  const member = (await db.doc('organizations/org-ext-req12345678/members/ext-req12345678').get()).data()!
  assert.equal(member.role, 'owner')
  assert.equal(member.email, 'tanaka@example.com')
})

test('同じリクエストの再送は同じ結果を返し、組織を重複作成しない', async () => {
  const auth = fakeAuth()
  const first = await createAccountFunc(db, input, auth)
  const second = await createAccountFunc(db, input, auth)

  assert.deepEqual(second, first)
  const orgs = await db.collection('organizations').where('ownerUid', '==', first.uid).get()
  assert.equal(orgs.size, 1)
})

test('Auth ユーザーだけできた状態から、再送で組織を作り直せる', async () => {
  const auth = fakeAuth(new Map([['ext-req12345678', 'tanaka@example.com']]))
  const { orgId } = await createAccountFunc(db, input, auth)
  assert.equal((await db.doc(`organizations/${orgId}`).get()).exists, true)
})

test('登録済みのメールアドレスは already-exists', async () => {
  const auth = fakeAuth(new Map([['u-web', 'tanaka@example.com']]))
  await assert.rejects(createAccountFunc(db, input, auth), { code: 'already-exists' })
  assert.equal(auth.users.has('ext-req12345678'), false)
})

test('同じ requestId を別のメールアドレスで使うと already-exists', async () => {
  const auth = fakeAuth()
  await createAccountFunc(db, input, auth)
  await assert.rejects(createAccountFunc(db, { ...input, email: 'other@example.com' }, auth), { code: 'already-exists' })
})

test('入力が不正なら Auth ユーザーを作らない', async () => {
  const auth = fakeAuth()
  await assert.rejects(createAccountFunc(db, { ...input, email: 'invalid' }, auth), { code: 'invalid-argument' })
  await assert.rejects(createAccountFunc(db, { ...input, type: 'unknown' }, auth), { code: 'invalid-argument' })
  await assert.rejects(createAccountFunc(db, { ...input, requestId: 'a'.repeat(101) }, auth), { code: 'invalid-argument' })
  assert.equal(auth.users.size, 0)
})
