import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { TEST_PROJECT_ID } from './emulator'

let env: RulesTestEnvironment

before(async () => {
  env = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    // lib-test/__tests__ から見たリポジトリ直下の firestore.rules
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
  })
})

after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const members: [string, string, string, string[]][] = [
      ['org-a', 'u-owner', 'owner', []],
      ['org-a', 'u-admin', 'admin', []],
      ['org-a', 'u-staff', 'staff', ['st-1']],
      ['org-b', 'u-other', 'owner', []],
    ]
    await setDoc(doc(db, 'users/u-owner'), { email: 'owner@example.com', displayName: 'Owner', platformRole: null })
    await setDoc(doc(db, 'organizations/org-a'), { type: 'corporate', name: 'A', status: 'active', ownerUid: 'u-owner' })
    await setDoc(doc(db, 'organizations/org-b'), { type: 'individual', name: 'B', status: 'active', ownerUid: 'u-other' })
    for (const [orgId, uid, role, storeIds] of members) {
      await setDoc(doc(db, `organizations/${orgId}/members/${uid}`), { orgId, uid, role, storeIds })
    }
    await setDoc(doc(db, 'organizations/org-a/stores/st-1'), { name: '渋谷店' })
    await setDoc(doc(db, 'organizations/org-a/stores/st-2'), { name: '新宿店' })
    await setDoc(doc(db, 'organizations/org-a/invitations/inv-1'), { email: 'x@example.com', status: 'pending' })
    await setDoc(doc(db, 'organizations/org-a/googleConnections/c-1'), { status: 'active' })
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-1'), { orgId: 'org-a', storeId: 'st-1', title: 'x' })
    await setDoc(doc(db, 'organizations/org-a/surveys/sv-2'), { orgId: 'org-a', storeId: 'st-2', title: 'y' })
    await setDoc(doc(db, 'organizations/org-a/surveyVersions/sv-1_1'), { orgId: 'org-a', surveyId: 'sv-1', storeId: 'st-1', version: 1 })
    await setDoc(doc(db, 'organizations/org-a/surveyVersions/sv-2_1'), { orgId: 'org-a', surveyId: 'sv-2', storeId: 'st-2', version: 1 })
    await setDoc(doc(db, 'organizations/org-a/responses/res-1'), { orgId: 'org-a', surveyId: 'sv-1', storeId: 'st-1', createdAt: new Date('2026-10-01T00:00:00Z') })
    await setDoc(doc(db, 'organizations/org-a/responses/res-2'), { orgId: 'org-a', surveyId: 'sv-2', storeId: 'st-2', createdAt: new Date('2026-10-01T00:00:00Z') })
    await setDoc(doc(db, 'publicSurveys/slug-1'), { slug: 'slug-1', orgId: 'org-a', surveyId: 'sv-1', status: 'published' })
    await setDoc(doc(db, 'rateLimits/slug-1_abc'), { hits: [] })
    await setDoc(doc(db, 'oauthTokens/c-1'), { encryptedRefreshToken: 'x' })
    await setDoc(doc(db, 'oauthStates/s-1'), { orgId: 'org-a' })
    await setDoc(doc(db, 'oauthClientSecrets/org-a'), { encryptedClientSecret: 'x' })
    await setDoc(doc(db, 'organizations/org-a/gbpProfiles/st-1'), { orgId: 'org-a', storeId: 'st-1', title: '渋谷店' })
    await setDoc(doc(db, 'organizations/org-a/gbpProfiles/st-2'), { orgId: 'org-a', storeId: 'st-2', title: '新宿店' })
    await setDoc(doc(db, 'organizations/org-a/gbpReviews/r-1'), { orgId: 'org-a', storeId: 'st-1', starRating: 5 })
    await setDoc(doc(db, 'organizations/org-a/gbpReviews/r-2'), { orgId: 'org-a', storeId: 'st-2', starRating: 3 })
    await setDoc(doc(db, 'organizations/org-a/gbpPosts/p-1'), { orgId: 'org-a', storeId: 'st-1', topicType: 'STANDARD' })
    await setDoc(doc(db, 'organizations/org-a/gbpPosts/p-2'), { orgId: 'org-a', storeId: 'st-2', topicType: 'STANDARD' })
    await setDoc(doc(db, 'organizations/org-a/replyTemplates/t-1'), { orgId: 'org-a', name: 'お礼', body: 'x' })
    await setDoc(doc(db, 'organizations/org-a/rankKeywords/kw-1'), { orgId: 'org-a', storeId: 'st-1', keyword: '渋谷 カフェ' })
    await setDoc(doc(db, 'organizations/org-a/rankKeywords/kw-2'), { orgId: 'org-a', storeId: 'st-2', keyword: '新宿 カフェ' })
    await setDoc(doc(db, 'organizations/org-a/rankSnapshots/kw-1_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-1', storeId: 'st-1', checkedOn: '2026-10-08' })
    await setDoc(doc(db, 'organizations/org-a/rankSnapshots/kw-2_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-2', storeId: 'st-2', checkedOn: '2026-10-08' })
    await setDoc(doc(db, 'organizations/org-a/rankResults/kw-1_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-1', storeId: 'st-1', results: [] })
    await setDoc(doc(db, 'organizations/org-a/rankResults/kw-2_2026-10-08'), { orgId: 'org-a', keywordId: 'kw-2', storeId: 'st-2', results: [] })
    await setDoc(doc(db, 'organizations/org-a/rankSearches/rs-1'), { orgId: 'org-a', keyword: '渋谷 カフェ', storeId: null })
    await setDoc(doc(db, 'organizations/org-a/usageMonthly/202610'), { orgId: 'org-a', rankChecks: 3 })
    await setDoc(doc(db, 'rankRuns/2026-10-08'), { done: 1, blocked: 0 })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anonymous = () => env.unauthenticatedContext().firestore()

test('users: 本人だけ読める。platformRole は変更できない', async () => {
  await assertSucceeds(getDoc(doc(as('u-owner'), 'users/u-owner')))
  await assertFails(getDoc(doc(as('u-admin'), 'users/u-owner')))
  await assertFails(getDoc(doc(anonymous(), 'users/u-owner')))
  await assertSucceeds(updateDoc(doc(as('u-owner'), 'users/u-owner'), { displayName: '新しい名前' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'users/u-owner'), { platformRole: 'operator' }))
})

test('organizations: メンバーだけ読める。書き込みは全員不可', async () => {
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a')))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a')))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a'), { name: 'x' }))
})

test('members: 同じ組織のメンバーは一覧を読める。他組織は不可。書き込みは不可', async () => {
  await assertSucceeds(getDocs(collection(as('u-staff'), 'organizations/org-a/members')))
  await assertFails(getDocs(collection(as('u-other'), 'organizations/org-a/members')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/members/u-new'), { orgId: 'org-a', uid: 'u-new', role: 'owner' }))
})

test('members（collection group）: 自分の所属だけを uid で絞り込めば読める', async () => {
  await assertSucceeds(getDocs(query(collectionGroup(as('u-owner'), 'members'), where('uid', '==', 'u-owner'))))
  await assertFails(getDocs(query(collectionGroup(as('u-owner'), 'members'), where('uid', '==', 'u-other'))))
  await assertFails(getDocs(collectionGroup(as('u-owner'), 'members')))
})

test('invitations / googleConnections: owner・admin のみ読める', async () => {
  for (const path of ['organizations/org-a/invitations', 'organizations/org-a/googleConnections']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertSucceeds(getDocs(collection(as('u-admin'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
  }
})

test('stores: owner は全店舗、staff は担当店舗だけ読める', async () => {
  await assertSucceeds(getDocs(collection(as('u-owner'), 'organizations/org-a/stores')))
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/stores/st-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/stores/st-2')))
  await assertFails(getDocs(collection(as('u-staff'), 'organizations/org-a/stores')))
  await assertSucceeds(getDocs(query(collection(as('u-staff'), 'organizations/org-a/stores'), where(documentId(), 'in', ['st-1']))))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a/stores/st-1')))
})

test('秘密のコレクションと未対応のコレクションは誰も読めない', async () => {
  await assertFails(getDoc(doc(as('u-owner'), 'oauthTokens/c-1')))
  await assertFails(getDoc(doc(as('u-owner'), 'oauthStates/s-1')))
  await assertFails(getDoc(doc(as('u-owner'), 'oauthClientSecrets/org-a')))
})

test('gbpProfiles / gbpReviews: owner は全店舗、staff は担当店舗だけ（storeId in で絞り込めば一覧も可）', async () => {
  for (const path of ['organizations/org-a/gbpProfiles', 'organizations/org-a/gbpReviews']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/gbpReviews/r-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/gbpReviews/r-2')))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/gbpReviews/r-1'), { hasReply: true }))
})

test('gbpPosts: owner は全店舗、staff は担当店舗だけ。書き込みは不可', async () => {
  const path = 'organizations/org-a/gbpPosts'
  await assertSucceeds(getDocs(collection(as('u-owner'), path)))
  await assertFails(getDocs(collection(as('u-staff'), path)))
  await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
  await assertFails(getDoc(doc(as('u-staff'), `${path}/p-2`)))
  await assertFails(getDocs(collection(as('u-other'), path)))
  await assertFails(setDoc(doc(as('u-owner'), `${path}/p-3`), { orgId: 'org-a', storeId: 'st-1' }))
})

test('replyTemplates: メンバーは読める、他組織と書き込みは不可', async () => {
  await assertSucceeds(getDocs(collection(as('u-staff'), 'organizations/org-a/replyTemplates')))
  await assertFails(getDocs(collection(as('u-other'), 'organizations/org-a/replyTemplates')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/replyTemplates/t-2'), { name: 'x' }))
})

test('rankKeywords / rankSnapshots / rankResults: owner は全店舗、staff は担当店舗だけ。書き込みは不可', async () => {
  for (const path of ['organizations/org-a/rankKeywords', 'organizations/org-a/rankSnapshots', 'organizations/org-a/rankResults']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/rankResults/kw-1_2026-10-08')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/rankResults/kw-2_2026-10-08')))
  await assertSucceeds(getDocs(query(collection(as('u-staff'), 'organizations/org-a/rankSnapshots'), where('storeId', 'in', ['st-1']), where('checkedOn', '>=', '2026-07-01'))))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/rankKeywords/kw-3'), { orgId: 'org-a', storeId: 'st-1' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/rankSnapshots/kw-1_2026-10-08'), { rank: 1 }))
})

test('rankSearches は owner / admin のみ、usageMonthly はメンバー、rankRuns は誰も読めない', async () => {
  await assertSucceeds(getDocs(collection(as('u-owner'), 'organizations/org-a/rankSearches')))
  await assertSucceeds(getDoc(doc(as('u-admin'), 'organizations/org-a/rankSearches/rs-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/rankSearches/rs-1')))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/rankSearches/rs-2'), { orgId: 'org-a' }))
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/usageMonthly/202610')))
  await assertFails(getDoc(doc(as('u-other'), 'organizations/org-a/usageMonthly/202610')))
  await assertFails(getDoc(doc(as('u-owner'), 'rankRuns/2026-10-08')))
})

test('surveys / surveyVersions / responses: owner は全店舗、staff は担当店舗だけ。書き込みは不可', async () => {
  for (const path of ['organizations/org-a/surveys', 'organizations/org-a/surveyVersions', 'organizations/org-a/responses']) {
    await assertSucceeds(getDocs(collection(as('u-owner'), path)))
    await assertFails(getDocs(collection(as('u-staff'), path)))
    await assertSucceeds(getDocs(query(collection(as('u-staff'), path), where('storeId', 'in', ['st-1']))))
    await assertFails(getDocs(collection(as('u-other'), path)))
    await assertFails(getDocs(collection(anonymous(), path)))
  }
  await assertSucceeds(getDoc(doc(as('u-staff'), 'organizations/org-a/responses/res-1')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/responses/res-2')))
  await assertFails(getDoc(doc(as('u-staff'), 'organizations/org-a/surveys/sv-2')))
  // useFirestoreSync の staff 向けの購読と同じ形
  await assertSucceeds(getDocs(query(
    collection(as('u-staff'), 'organizations/org-a/responses'),
    where('storeId', 'in', ['st-1']),
    where('createdAt', '>=', new Date('2026-07-01T00:00:00Z')),
    orderBy('createdAt', 'desc'),
    limit(2000),
  )))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-3'), { orgId: 'org-a', storeId: 'st-1' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'organizations/org-a/surveys/sv-1'), { title: 'z' }))
  await assertFails(setDoc(doc(as('u-owner'), 'organizations/org-a/responses/res-3'), { orgId: 'org-a', storeId: 'st-1' }))
})

test('publicSurveys は未ログインでも slug 指定の 1 件は読めるが、一覧と書き込みはできない。rateLimits は誰も読めない', async () => {
  await assertSucceeds(getDoc(doc(anonymous(), 'publicSurveys/slug-1')))
  // slug を指定した 1 件の取得だけ許可し、一覧は許可しない
  await assertFails(getDocs(collection(anonymous(), 'publicSurveys')))
  await assertFails(getDocs(collection(as('u-owner'), 'publicSurveys')))
  await assertFails(setDoc(doc(anonymous(), 'publicSurveys/slug-2'), { status: 'published' }))
  await assertFails(updateDoc(doc(as('u-owner'), 'publicSurveys/slug-1'), { status: 'paused' }))
  await assertFails(getDoc(doc(anonymous(), 'rateLimits/slug-1_abc')))
  await assertFails(getDoc(doc(as('u-owner'), 'rateLimits/slug-1_abc')))
})
