import type {
  Answers,
  GbpLocation,
  GbpPost,
  GbpProfile,
  GbpReview,
  GoogleConnection,
  Invitation,
  Member,
  Organization,
  PublicSurvey,
  RankKeyword,
  RankResultsDoc,
  RankSearch,
  ReplyTemplate,
  RankSnapshot,
  Store,
  Survey,
  SurveyResponse,
  SurveyVersion,
  UsageMonthly,
  User,
} from '~/types/domain'
import { evaluateRedirectRule } from '../evaluateRedirectRule'
import { toDayKey, toMonthKey } from '../format'
import { createStandardContent } from '../surveyTemplates'
import { createGbpSeed } from './gbpSeed'
import { createRandom, pick, pickWeighted, randomInt } from './random'
import { createMockCheck } from './rank'
import { nearestMunicipality } from '../geo/municipality'

// Firebase 接続前の仮データ。Firestore のコレクションと同じ単位で配列を持つ。
// 値はシード付き乱数で生成するため、リロードしても同じ内容になる（日付だけは今日基準）。

export interface MockDb {
  users: User[]
  organizations: Organization[]
  members: Member[]
  invitations: Invitation[]
  googleConnections: GoogleConnection[]
  gbpLocations: GbpLocation[]
  stores: Store[]
  surveys: Survey[]
  surveyVersions: SurveyVersion[]
  publicSurveys: PublicSurvey[]
  responses: SurveyResponse[]
  rankKeywords: RankKeyword[]
  rankSnapshots: RankSnapshot[]
  rankResults: RankResultsDoc[]
  rankSearches: RankSearch[]
  usage: UsageMonthly[]
  gbpProfiles: GbpProfile[]
  gbpReviews: GbpReview[]
  gbpPosts: GbpPost[]
  replyTemplates: ReplyTemplate[]
}

export const DEMO_PASSWORD = 'password'

export const DEMO_ACCOUNTS = [
  { uid: 'u-kobayashi', label: '個人 / オーナー', description: 'カフェ こもれび（1 店舗）' },
  { uid: 'u-tanaka', label: '法人 / オーナー', description: '株式会社ハナミ食堂（3 店舗）' },
  { uid: 'u-sato', label: '法人 / スタッフ', description: '渋谷店のみ担当' },
  { uid: 'u-ops', label: '運営', description: '全組織を横断して管理' },
] as const

export function buildReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

function daysAgo(base: Date, days: number, hour = 12): Date {
  const date = new Date(base)
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date
}

const COMMENTS = [
  'ランチの日替わり定食がおいしかった',
  'スタッフの方が丁寧に説明してくれた',
  '窓際の席が明るくて居心地がよかった',
  '料理が出てくるのが早くて助かった',
  'お昼時は少し混んでいた',
  'ボリュームがあって満足',
  '',
]

function createResponses(
  base: Date,
  survey: Survey,
  version: SurveyVersion,
  count: number,
  seed: number,
): SurveyResponse[] {
  const random = createRandom(seed)
  const content = version.content
  return Array.from({ length: count }, (_, index) => {
    const rating = pickWeighted(random, [[1, 3], [2, 5], [3, 14], [4, 38], [5, 40]] as const)
    const goodCount = rating >= 4 ? randomInt(random, 1, 3) : randomInt(random, 0, 1)
    const goodIds = ['o-taste', 'o-service', 'o-atmosphere', 'o-price', 'o-speed'].filter(() => random() < 0.5).slice(0, goodCount)
    const comment = random() < 0.4 ? pick(random, COMMENTS) : ''
    const answers: Answers = {
      'q-overall': rating,
      'q-good': goodIds,
      'q-recommend': Math.min(10, Math.max(0, rating * 2 + randomInt(random, -2, 0))),
    }
    if (comment) answers['q-comment'] = comment

    const isEligible = evaluateRedirectRule(content.redirectRule, answers)
    // 前期間との比較ができるよう、直近 60 日に分散させる
    const createdAt = daysAgo(base, randomInt(random, 0, 59), randomInt(random, 11, 21))
    const isRedirected = isEligible && random() < 0.6
    return {
      id: `res-${survey.id}-${index}`,
      orgId: survey.orgId,
      surveyId: survey.id,
      storeId: survey.storeId,
      surveyVersion: version.version,
      answers,
      isEligible,
      reviewDraft: null,
      redirectedAt: isRedirected ? new Date(createdAt.getTime() + 90_000).toISOString() : null,
      createdAt: createdAt.toISOString(),
    }
  })
}

function toPublicSurvey(survey: Survey, version: SurveyVersion, storeName: string): PublicSurvey {
  return {
    slug: survey.publicSlug,
    orgId: survey.orgId,
    surveyId: survey.id,
    storeId: survey.storeId,
    version: version.version,
    storeName,
    questions: structuredClone(version.content.questions),
    design: structuredClone(version.content.design),
    status: survey.status === 'paused' ? 'paused' : 'published',
    publishPeriod: { ...survey.publishPeriod },
  }
}

export function createSeed(now = new Date()): MockDb {
  const iso = (days: number) => daysAgo(now, days).toISOString()

  const users: User[] = [
    { uid: 'u-kobayashi', email: 'kobayashi@example.com', displayName: '小林 美咲', isOperator: false },
    { uid: 'u-tanaka', email: 'tanaka@example.com', displayName: '田中 健一', isOperator: false },
    { uid: 'u-suzuki', email: 'suzuki@example.com', displayName: '鈴木 陽子', isOperator: false },
    { uid: 'u-sato', email: 'sato@example.com', displayName: '佐藤 大輔', isOperator: false },
    { uid: 'u-kimura', email: 'kimura@example.com', displayName: '木村 彩', isOperator: false },
    { uid: 'u-ops', email: 'ops@example.com', displayName: '運営 山本', isOperator: true },
  ]

  const organizations: Organization[] = [
    {
      id: 'org-komorebi',
      type: 'individual',
      name: 'カフェ こもれび',
      plan: 'ライト',
      status: 'active',
      limits: { maxStores: 1, maxSurveys: 3, maxKeywords: 5, maxMembers: 1, monthlyReviewDrafts: 100, monthlyRankChecks: 200 },
      ownerUid: 'u-kobayashi',
      createdAt: iso(180),
    },
    {
      id: 'org-hanami',
      type: 'corporate',
      name: '株式会社ハナミ食堂',
      plan: 'ビジネス',
      status: 'active',
      limits: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
      ownerUid: 'u-tanaka',
      createdAt: iso(240),
    },
    {
      id: 'org-yamato',
      type: 'corporate',
      name: '大和ビューティー株式会社',
      plan: 'ビジネス',
      status: 'suspended',
      limits: { maxStores: 10, maxSurveys: 30, maxKeywords: 50, maxMembers: 20, monthlyReviewDrafts: 2000, monthlyRankChecks: 3000 },
      ownerUid: 'u-kimura',
      createdAt: iso(400),
    },
  ]

  const members: Member[] = [
    { orgId: 'org-komorebi', uid: 'u-kobayashi', role: 'owner', storeIds: [], email: 'kobayashi@example.com', displayName: '小林 美咲', joinedAt: iso(180) },
    { orgId: 'org-hanami', uid: 'u-tanaka', role: 'owner', storeIds: [], email: 'tanaka@example.com', displayName: '田中 健一', joinedAt: iso(240) },
    { orgId: 'org-hanami', uid: 'u-suzuki', role: 'admin', storeIds: [], email: 'suzuki@example.com', displayName: '鈴木 陽子', joinedAt: iso(200) },
    { orgId: 'org-hanami', uid: 'u-sato', role: 'staff', storeIds: ['st-hanami-shibuya'], email: 'sato@example.com', displayName: '佐藤 大輔', joinedAt: iso(90) },
    { orgId: 'org-yamato', uid: 'u-kimura', role: 'owner', storeIds: [], email: 'kimura@example.com', displayName: '木村 彩', joinedAt: iso(400) },
  ]

  const invitations: Invitation[] = [
    {
      id: 'inv-yamada',
      orgId: 'org-hanami',
      email: 'yamada@example.com',
      role: 'staff',
      storeIds: ['st-hanami-shinjuku'],
      status: 'pending',
      token: 'demo-invite-hanami',
      expiresAt: daysAgo(now, -5).toISOString(),
      invitedBy: 'u-tanaka',
      createdAt: iso(2),
    },
    {
      id: 'inv-ito',
      orgId: 'org-hanami',
      email: 'ito@example.com',
      role: 'admin',
      storeIds: [],
      status: 'expired',
      token: 'demo-invite-expired',
      expiresAt: iso(10),
      invitedBy: 'u-tanaka',
      createdAt: iso(17),
    },
  ]

  const googleConnections: GoogleConnection[] = [
    {
      id: 'conn-komorebi',
      orgId: 'org-komorebi',
      googleEmail: 'komorebi.cafe@gmail.com',
      gbpAccounts: [{ name: 'accounts/100000000000000000001', accountName: 'カフェ こもれび' }],
      status: 'active',
      lastError: null,
      connectedAt: iso(170),
    },
    {
      id: 'conn-hanami',
      orgId: 'org-hanami',
      googleEmail: 'hq@hanami-shokudo.example.com',
      gbpAccounts: [{ name: 'accounts/100000000000000000002', accountName: 'ハナミ食堂グループ' }],
      status: 'active',
      lastError: null,
      connectedAt: iso(230),
    },
  ]

  const gbpLocations: GbpLocation[] = [
    { connectionId: 'conn-komorebi', locationName: 'locations/2001', title: 'カフェ こもれび 下北沢', address: '東京都世田谷区北沢2-10-15', placeId: 'mock-place-komorebi', lat: 35.6613, lng: 139.668 },
    { connectionId: 'conn-hanami', locationName: 'locations/3001', title: '定食 ハナミ 渋谷店', address: '東京都渋谷区道玄坂1-2-3', placeId: 'mock-place-hanami-shibuya', lat: 35.658, lng: 139.6981 },
    { connectionId: 'conn-hanami', locationName: 'locations/3002', title: '定食 ハナミ 新宿店', address: '東京都新宿区西新宿1-5-1', placeId: 'mock-place-hanami-shinjuku', lat: 35.6905, lng: 139.6995 },
    { connectionId: 'conn-hanami', locationName: 'locations/3003', title: '定食 ハナミ 池袋店', address: '東京都豊島区南池袋1-20-4', placeId: 'mock-place-hanami-ikebukuro', lat: 35.7295, lng: 139.7109 },
    { connectionId: 'conn-hanami', locationName: 'locations/3004', title: '定食 ハナミ 上野店', address: '東京都台東区上野4-8-1', placeId: 'mock-place-hanami-ueno', lat: 35.7099, lng: 139.7745 },
    { connectionId: 'conn-hanami', locationName: 'locations/3005', title: 'ハナミ食堂 本部オフィス', address: '東京都港区芝5-1-1', placeId: null, lat: 35.6467, lng: 139.7488 },
  ]

  const stores: Store[] = gbpLocations
    .filter(location => ['locations/2001', 'locations/3001', 'locations/3002', 'locations/3003'].includes(location.locationName))
    .map((location) => {
      const connection = googleConnections.find(item => item.id === location.connectionId)!
      const suffix = location.locationName === 'locations/2001' ? 'komorebi' : `hanami-${location.placeId!.split('-').pop()}`
      return {
        id: `st-${suffix}`,
        orgId: connection.orgId,
        name: location.title,
        address: location.address,
        lat: location.lat,
        lng: location.lng,
        connectionId: connection.id,
        gbpLocationName: location.locationName,
        placeId: location.placeId!,
        reviewUrl: buildReviewUrl(location.placeId!),
        status: 'active',
      }
    })

  const komorebiContent = createStandardContent('ドリンク・フードの味', ['自家焙煎のコーヒー', '季節のタルト'])
  const hanamiContent = createStandardContent('料理の味', ['日替わりの焼き魚定食', '炊きたての土鍋ごはん'])
  const shibuyaDraft = structuredClone(hanamiContent)
  shibuyaDraft.questions.splice(3, 0, {
    id: 'q-visit',
    type: 'single',
    label: '今回ご来店いただいたきっかけを教えてください',
    isRequired: false,
    options: [
      { id: 'o-map', label: 'Google マップ' },
      { id: 'o-sns', label: 'SNS' },
      { id: 'o-friend', label: '知人の紹介' },
      { id: 'o-walk', label: '通りがかり' },
    ],
    useForReviewDraft: false,
  })

  const surveySpecs = [
    { id: 'sv-komorebi-main', orgId: 'org-komorebi', storeId: 'st-komorebi', title: 'ご来店アンケート', status: 'published', slug: 'k7m2q9x4pa', content: komorebiContent, draft: komorebiContent, responses: 84, created: 150 },
    { id: 'sv-hanami-shibuya', orgId: 'org-hanami', storeId: 'st-hanami-shibuya', title: '渋谷店 ご来店アンケート', status: 'published', slug: 'h3n8r2t6vb', content: hanamiContent, draft: shibuyaDraft, responses: 136, created: 120 },
    { id: 'sv-hanami-shinjuku', orgId: 'org-hanami', storeId: 'st-hanami-shinjuku', title: '新宿店 ご来店アンケート', status: 'paused', slug: 'h9p4w7c2zd', content: hanamiContent, draft: hanamiContent, responses: 70, created: 110 },
    { id: 'sv-hanami-ikebukuro', orgId: 'org-hanami', storeId: 'st-hanami-ikebukuro', title: '池袋店 ランチ限定アンケート', status: 'draft', slug: 'h5j1s8e3fk', content: null, draft: hanamiContent, responses: 0, created: 3 },
    { id: 'sv-hanami-shibuya-1st', orgId: 'org-hanami', storeId: 'st-hanami-shibuya', title: '渋谷店 開店 1 周年アンケート', status: 'closed', slug: 'h2d6y4u9mn', content: hanamiContent, draft: hanamiContent, responses: 0, created: 300 },
  ] as const

  const surveys: Survey[] = []
  const surveyVersions: SurveyVersion[] = []
  const publicSurveys: PublicSurvey[] = []
  const responses: SurveyResponse[] = []

  surveySpecs.forEach((spec, index) => {
    const store = stores.find(item => item.id === spec.storeId)!
    const survey: Survey = {
      id: spec.id,
      orgId: spec.orgId,
      storeId: spec.storeId,
      title: spec.title,
      status: spec.status,
      publicSlug: spec.slug,
      draft: structuredClone(spec.draft),
      currentVersion: spec.content ? 1 : null,
      hasUnpublishedChanges: spec.content !== null && spec.draft !== spec.content,
      publishPeriod: { startAt: null, endAt: null },
      createdAt: iso(spec.created),
      updatedAt: iso(spec.content === spec.draft ? spec.created : 1),
    }
    surveys.push(survey)
    if (!spec.content) return

    const version: SurveyVersion = {
      orgId: spec.orgId,
      surveyId: spec.id,
      version: 1,
      content: structuredClone(spec.content),
      publishedBy: organizations.find(org => org.id === spec.orgId)!.ownerUid,
      publishedAt: iso(spec.created - 1),
    }
    surveyVersions.push(version)
    if (spec.status === 'published' || spec.status === 'paused') {
      publicSurveys.push(toPublicSurvey(survey, version, store.name))
    }
    responses.push(...createResponses(now, survey, version, spec.responses, 1000 + index))
  })

  const keywordSpecs = [
    ['org-komorebi', 'st-komorebi', '下北沢 カフェ', true],
    ['org-komorebi', 'st-komorebi', '下北沢 コーヒー', true],
    ['org-komorebi', 'st-komorebi', '世田谷 タルト', false],
    ['org-hanami', 'st-hanami-shibuya', '渋谷 定食', true],
    ['org-hanami', 'st-hanami-shibuya', '渋谷 ランチ', true],
    ['org-hanami', 'st-hanami-shinjuku', '新宿 定食', true],
    ['org-hanami', 'st-hanami-shinjuku', '西新宿 ランチ', true],
    ['org-hanami', 'st-hanami-ikebukuro', '池袋 定食', true],
  ] as const

  const rankKeywords: RankKeyword[] = keywordSpecs.map(([orgId, storeId, keyword, isActive], index) => {
    const store = stores.find(item => item.id === storeId)!
    return {
      id: `kw-${index + 1}`,
      orgId,
      storeId,
      keyword,
      searchLocation: { lat: store.lat, lng: store.lng, label: nearestMunicipality(store.lat, store.lng)?.label ?? `${store.name} 周辺` },
      isActive,
      createdAt: iso(60),
      pendingCheckAt: null,
    }
  })

  const rankChecks = rankKeywords.flatMap((keyword) => {
    const store = stores.find(item => item.id === keyword.storeId)!
    // 停止中のキーワードは停止前（15 日前まで）の履歴だけ持つ
    const firstDay = keyword.isActive ? 0 : 15
    return Array.from({ length: 90 - firstDay }, (_, offset) => {
      const date = daysAgo(now, firstDay + offset, 6)
      return createMockCheck(keyword, store, toDayKey(date), date.toISOString(), 'scheduled')
    })
  })
  const rankSnapshots: RankSnapshot[] = rankChecks.map(check => check.snapshot)
  const rankResults: RankResultsDoc[] = rankChecks.flatMap(check => (check.results ? [check.results] : []))

  const month = toMonthKey(now)
  const usage: UsageMonthly[] = organizations.map((org) => {
    const orgResponses = responses.filter(item => item.orgId === org.id)
    const activeKeywords = rankKeywords.filter(item => item.orgId === org.id && item.isActive).length
    return {
      orgId: org.id,
      month,
      reviewDrafts: orgResponses.filter(item => item.reviewDraft).length,
      rankChecks: activeKeywords * now.getDate(),
      responses: orgResponses.length,
    }
  })

  return {
    users,
    organizations,
    members,
    invitations,
    googleConnections,
    gbpLocations,
    stores,
    surveys,
    surveyVersions,
    publicSurveys,
    responses,
    rankKeywords,
    rankSnapshots,
    rankResults,
    rankSearches: [],
    usage,
    ...createGbpSeed(stores, now),
  }
}
