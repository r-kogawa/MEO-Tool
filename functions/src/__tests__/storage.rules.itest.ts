import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { TEST_PROJECT_ID } from './emulator'

let env: RulesTestEnvironment
const MB = 1024 * 1024

before(async () => {
  env = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    // lib-test/__tests__ から見たリポジトリ直下のルール。Storage ルールは Firestore のメンバーを参照する
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(__dirname, '../../../storage.rules'), 'utf8') },
  })
})

after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'organizations/org-a/members/u-owner'), { orgId: 'org-a', uid: 'u-owner', role: 'owner', storeIds: [] })
    await context.storage().ref('orgs/org-a/gbpPosts/seed.png').put(new Uint8Array(10), { contentType: 'image/png' })
  })
})

function storageOf(uid: string | null) {
  return (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage()
}

async function upload(uid: string | null, path: string, bytes: number, contentType: string): Promise<void> {
  await storageOf(uid).ref(path).put(new Uint8Array(bytes), { contentType })
}

test('storage: メンバーは自組織に 5MB 以下の JPEG / PNG だけアップロードできる', async () => {
  await assertSucceeds(upload('u-owner', 'orgs/org-a/gbpPosts/a.png', 1024, 'image/png'))
  await assertSucceeds(upload('u-owner', 'orgs/org-a/gbpPosts/b.jpg', 5 * MB, 'image/jpeg'))
  await assertFails(upload('u-owner', 'orgs/org-a/gbpPosts/c.png', 5 * MB + 1, 'image/png'))
  await assertFails(upload('u-owner', 'orgs/org-a/gbpPosts/d.gif', 1024, 'image/gif'))
  await assertFails(upload('u-owner', 'orgs/org-b/gbpPosts/e.png', 1024, 'image/png'))
  await assertFails(upload('u-other', 'orgs/org-a/gbpPosts/f.png', 1024, 'image/png'))
  await assertFails(upload(null, 'orgs/org-a/gbpPosts/g.png', 1024, 'image/png'))
  await assertFails(upload('u-owner', 'orgs/org-a/other/h.png', 1024, 'image/png'))
})

test('storage: 読み取りは同じ組織のメンバーだけ。上書き・削除は不可', async () => {
  await assertSucceeds(storageOf('u-owner').ref('orgs/org-a/gbpPosts/seed.png').getMetadata())
  await assertFails(storageOf('u-other').ref('orgs/org-a/gbpPosts/seed.png').getMetadata())
  await assertFails(upload('u-owner', 'orgs/org-a/gbpPosts/seed.png', 10, 'image/png'))
  await assertFails(storageOf('u-owner').ref('orgs/org-a/gbpPosts/seed.png').delete())
})
