import { onAuthStateChanged } from 'firebase/auth'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import type { GbpPost, GbpProfile, GbpReview, GoogleConnection, Invitation, Member, Organization, RankKeyword, RankSearch, RankSnapshot, ReplyTemplate, Store, Survey, SurveyResponse, SurveyVersion } from '~/types/domain'
import {
  toGbpProfile,
  toGbpPost,
  toGbpReview,
  toGoogleConnection,
  toInvitation,
  toMember,
  toOrganization,
  toRankKeyword,
  toRankSearch,
  toRankSnapshot,
  toReplyTemplate,
  toStore,
  toSurvey,
  toSurveyResponse,
  toSurveyVersion,
  toUser,
} from '~/utils/firebase/converters'
import { createEmptyDb } from '~/utils/firebase/emptyDb'
import { MirrorCollection } from '~/utils/firebase/mirror'
import { toDayKey } from '~/utils/format'

// 本物モードで Firestore を購読し、useAppDb() の DB に流し込む。
// ・ログインユーザー: 自分の所属（collectionGroup members）と所属組織のドキュメント
// ・表示中の組織: メンバー・店舗、owner / admin なら招待と Google 連携も
// ・アンケート: surveys / surveyVersions は組織のものすべて、responses は直近 90 日・最大 2,000 件（publicSurveys は購読しない）

/** documentId() の in は 30 件まで */
const IN_QUERY_LIMIT = 30

function stopAll(unsubscribes: Unsubscribe[]): void {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes.length = 0
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

/** ログイン直後の表示名の更新（updateProfile）は onAuthStateChanged が発火しないため、手動で反映する */
export function refreshAuthUser(): void {
  const { $auth } = useNuxtApp()
  const db = useAppDb()
  if ($auth.currentUser) db.value.users = [toUser($auth.currentUser)]
}

export function startFirestoreSync(): void {
  const { $auth, $db } = useNuxtApp()
  const db = useAppDb()
  const { state } = useBackendReady()
  const router = useRouter()

  const organizations = new MirrorCollection<Organization>(item => item.id, (items) => { db.value.organizations = items })
  const members = new MirrorCollection<Member>(item => `${item.orgId}/${item.uid}`, (items) => { db.value.members = items })
  const stores = new MirrorCollection<Store>(item => item.id, (items) => { db.value.stores = items })
  const invitations = new MirrorCollection<Invitation>(item => item.id, (items) => { db.value.invitations = items })
  const connections = new MirrorCollection<GoogleConnection>(item => item.id, (items) => { db.value.googleConnections = items })
  const profiles = new MirrorCollection<GbpProfile>(item => item.storeId, (items) => { db.value.gbpProfiles = items })
  const reviews = new MirrorCollection<GbpReview>(item => item.id, (items) => { db.value.gbpReviews = items })
  const posts = new MirrorCollection<GbpPost>(item => item.id, (items) => { db.value.gbpPosts = items })
  const templates = new MirrorCollection<ReplyTemplate>(item => item.id, (items) => { db.value.replyTemplates = items })
  const rankKeywords = new MirrorCollection<RankKeyword>(item => item.id, (items) => { db.value.rankKeywords = items })
  const rankSnapshots = new MirrorCollection<RankSnapshot>(item => `${item.keywordId}_${item.checkedOn}`, (items) => { db.value.rankSnapshots = items })
  const rankSearches = new MirrorCollection<RankSearch>(item => item.id, (items) => { db.value.rankSearches = items })
  const surveys = new MirrorCollection<Survey>(item => item.id, (items) => { db.value.surveys = items })
  const surveyVersions = new MirrorCollection<SurveyVersion>(item => `${item.surveyId}_${item.version}`, (items) => { db.value.surveyVersions = items })
  const responses = new MirrorCollection<SurveyResponse>(item => item.id, (items) => { db.value.responses = items })

  const userSubscriptions: Unsubscribe[] = []
  const orgDocSubscriptions = new Map<string, Unsubscribe>()
  /** 初回のスナップショットを受け取った組織。全所属分がそろったら isOrgsReady にする */
  const receivedOrgIds = new Set<string>()
  const currentOrgSubscriptions: Unsubscribe[] = []

  function resetAll(): void {
    stopAll(userSubscriptions)
    stopAll(currentOrgSubscriptions)
    for (const unsubscribe of orgDocSubscriptions.values()) unsubscribe()
    orgDocSubscriptions.clear()
    receivedOrgIds.clear()
    for (const mirror of [organizations, members, stores, invitations, connections, profiles, reviews, posts, templates, rankKeywords, rankSnapshots, rankSearches, surveys, surveyVersions, responses]) mirror.clear()
    db.value = createEmptyDb()
  }

  /** 所属組織のドキュメントを、所属の増減に合わせて購読・解除する */
  function syncOrgDocs(orgIds: string[]): void {
    for (const [orgId, unsubscribe] of orgDocSubscriptions) {
      if (orgIds.includes(orgId)) continue
      unsubscribe()
      orgDocSubscriptions.delete(orgId)
      receivedOrgIds.delete(orgId)
      organizations.delete(orgId)
    }
    for (const orgId of orgIds) {
      if (orgDocSubscriptions.has(orgId)) continue
      const markReceived = () => {
        receivedOrgIds.add(orgId)
        markOrgsReadyIfComplete()
      }
      orgDocSubscriptions.set(orgId, onSnapshot(doc($db, `organizations/${orgId}`), (snapshot) => {
        organizations.set(orgId, snapshot.exists() ? [toOrganization(snapshot.id, snapshot.data())] : [])
        markReceived()
      }, markReceived))
    }
    markOrgsReadyIfComplete()
  }

  /** 所属一覧と、所属する全組織のドキュメントが届いたら初回読み込み完了（ミドルウェアが待っている） */
  function markOrgsReadyIfComplete(): void {
    if ([...orgDocSubscriptions.keys()].every(orgId => receivedOrgIds.has(orgId))) state.value.isOrgsReady = true
  }

  function watchMemberships(uid: string): void {
    const membershipQuery = query(collectionGroup($db, 'members'), where('uid', '==', uid))
    userSubscriptions.push(onSnapshot(membershipQuery, (snapshot) => {
      const mine = snapshot.docs.map(item => toMember(item.data()))
      members.set('mine', mine)
      syncOrgDocs(mine.map(member => member.orgId))
    }, () => {
      state.value.isOrgsReady = true
    }))
  }

  function watchStores(orgId: string, member: Member): void {
    const storesPath = `organizations/${orgId}/stores`
    if (member.role !== 'staff') {
      currentOrgSubscriptions.push(onSnapshot(collection($db, storesPath), (snapshot) => {
        stores.set('current', snapshot.docs.map(item => toStore(item.id, orgId, item.data())))
      }))
      return
    }
    // staff は担当店舗だけを documentId で絞り込む（ルールが担当外の読み取りを拒否するため）
    chunk(member.storeIds, IN_QUERY_LIMIT).forEach((storeIds, index) => {
      currentOrgSubscriptions.push(onSnapshot(query(collection($db, storesPath), where(documentId(), 'in', storeIds)), (snapshot) => {
        stores.set(`current-${index}`, snapshot.docs.map(item => toStore(item.id, orgId, item.data())))
      }))
    })
  }

  /** 表示する口コミの上限（新しい順）。古い口コミは GBP の画面で確認する */
  const REVIEW_LIMIT = 500
  /** 表示する投稿の上限（新しい順） */
  const POST_LIMIT = 200
  /** 順位の推移は最大 90 日表示する */
  const RANK_HISTORY_DAYS = 90
  /** その場計測の履歴（新しい順） */
  const RANK_SEARCH_LIMIT = 30
  /** 回答は直近 90 日・新しい順に最大 2,000 件。それより前は CSV（getResponsesCsv）で確認する */
  const RESPONSE_DAYS = 90
  const RESPONSE_LIMIT = 2000

  /** 店舗ごとのデータを購読する。staff は担当店舗だけを storeId in で絞り込む（ルールが担当外を拒否するため） */
  function watchStoreScoped<T>(
    orgId: string,
    member: Member,
    path: string,
    mirror: MirrorCollection<T>,
    toItem: (id: string, data: DocumentData) => T,
    constraints: QueryConstraint[] = [],
  ): void {
    const base = collection($db, `organizations/${orgId}/${path}`)
    if (member.role !== 'staff') {
      currentOrgSubscriptions.push(onSnapshot(query(base, ...constraints), (snapshot) => {
        mirror.set('current', snapshot.docs.map(item => toItem(item.id, item.data())))
      }))
      return
    }
    chunk(member.storeIds, IN_QUERY_LIMIT).forEach((storeIds, index) => {
      currentOrgSubscriptions.push(onSnapshot(query(base, where('storeId', 'in', storeIds), ...constraints), (snapshot) => {
        mirror.set(`current-${index}`, snapshot.docs.map(item => toItem(item.id, item.data())))
      }))
    })
  }

  function watchCurrentOrg(orgId: string, member: Member | null): void {
    stopAll(currentOrgSubscriptions)
    for (const mirror of [stores, invitations, connections, profiles, reviews, posts, templates, rankKeywords, rankSnapshots, rankSearches, surveys, surveyVersions, responses]) mirror.clear()
    members.delete('current')
    if (!orgId || !member) return

    currentOrgSubscriptions.push(onSnapshot(collection($db, `organizations/${orgId}/members`), (snapshot) => {
      members.set('current', snapshot.docs.map(item => toMember(item.data())))
    }))
    watchStores(orgId, member)
    watchStoreScoped(orgId, member, 'gbpProfiles', profiles, (_, data) => toGbpProfile(data))
    watchStoreScoped(orgId, member, 'gbpReviews', reviews, toGbpReview, [orderBy('reviewCreatedAt', 'desc'), limit(REVIEW_LIMIT)])
    watchStoreScoped(orgId, member, 'gbpPosts', posts, toGbpPost, [orderBy('createdAt', 'desc'), limit(POST_LIMIT)])
    watchStoreScoped(orgId, member, 'rankKeywords', rankKeywords, (id, data) => toRankKeyword(id, orgId, data))
    const rankFrom = toDayKey(new Date(Date.now() - RANK_HISTORY_DAYS * 86_400_000))
    watchStoreScoped(orgId, member, 'rankSnapshots', rankSnapshots, (_, data) => toRankSnapshot(data), [where('checkedOn', '>=', rankFrom)])
    watchStoreScoped(orgId, member, 'surveys', surveys, (id, data) => toSurvey(id, orgId, data))
    watchStoreScoped(orgId, member, 'surveyVersions', surveyVersions, (_, data) => toSurveyVersion(data))
    // staff は storeId in ＋ createdAt の降順（インデックス responses (storeId, createdAt DESC)）
    const responseFrom = new Date(Date.now() - RESPONSE_DAYS * 86_400_000)
    watchStoreScoped(orgId, member, 'responses', responses, toSurveyResponse, [where('createdAt', '>=', responseFrom), orderBy('createdAt', 'desc'), limit(RESPONSE_LIMIT)])
    currentOrgSubscriptions.push(onSnapshot(collection($db, `organizations/${orgId}/replyTemplates`), (snapshot) => {
      templates.set('current', snapshot.docs.map(item => toReplyTemplate(item.id, item.data())))
    }))
    if (member.role === 'staff') return
    currentOrgSubscriptions.push(onSnapshot(
      query(collection($db, `organizations/${orgId}/rankSearches`), orderBy('createdAt', 'desc'), limit(RANK_SEARCH_LIMIT)),
      (snapshot) => { rankSearches.set('current', snapshot.docs.map(item => toRankSearch(item.id, orgId, item.data()))) },
    ))
    currentOrgSubscriptions.push(onSnapshot(collection($db, `organizations/${orgId}/invitations`), (snapshot) => {
      invitations.set('current', snapshot.docs.map(item => toInvitation(item.id, item.data())))
    }))
    currentOrgSubscriptions.push(onSnapshot(collection($db, `organizations/${orgId}/googleConnections`), (snapshot) => {
      connections.set('current', snapshot.docs.map(item => toGoogleConnection(item.id, orgId, item.data())))
    }))
  }

  onAuthStateChanged($auth, (authUser) => {
    resetAll()
    state.value.isOrgsReady = false
    if (!authUser) {
      state.value.isAuthReady = true
      state.value.isOrgsReady = true
      return
    }
    db.value.users = [toUser(authUser)]
    state.value.isAuthReady = true
    watchMemberships(authUser.uid)
  })

  // 表示中の組織・自分のロール・担当店舗が変わったら購読し直す
  watch(
    () => {
      const orgId = String(router.currentRoute.value.params.orgId ?? '')
      const uid = db.value.users[0]?.uid
      const member = db.value.members.find(item => item.orgId === orgId && item.uid === uid) ?? null
      return { orgId, member, key: `${orgId}|${member?.role}|${member?.storeIds.join(',')}` }
    },
    (next, previous) => {
      if (next.key !== previous?.key) watchCurrentOrg(next.orgId, next.member)
    },
    { immediate: true },
  )
}
