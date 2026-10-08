// docs/02-database.md のコレクション定義に対応するドメイン型。
// Firebase 接続後も同じ型を Firestore の変換に使う。

export type OrgType = 'individual' | 'corporate'
export type OrgStatus = 'active' | 'suspended' | 'deleted'
export type MemberRole = 'owner' | 'admin' | 'staff'

export interface User {
  uid: string
  email: string
  displayName: string
  isOperator: boolean
}

export interface OrgLimits {
  maxStores: number
  maxSurveys: number
  maxKeywords: number
  maxMembers: number
  monthlyReviewDrafts: number
  monthlyRankChecks: number
}

export interface Organization {
  id: string
  type: OrgType
  name: string
  plan: string
  status: OrgStatus
  limits: OrgLimits
  ownerUid: string
  createdAt: string
  /** 組織が登録した Google OAuth クライアント（シークレットは Functions 側にだけある） */
  googleOAuthClient?: { clientId: string; configuredAt: string } | null
}

export interface Member {
  orgId: string
  uid: string
  role: MemberRole
  /** staff の担当店舗。owner / admin は空でも全店舗を扱える */
  storeIds: string[]
  email: string
  displayName: string
  joinedAt: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Invitation {
  id: string
  orgId: string
  email: string
  role: Exclude<MemberRole, 'owner'>
  storeIds: string[]
  status: InvitationStatus
  token: string
  expiresAt: string
  invitedBy: string
  createdAt: string
}

export type ConnectionStatus = 'active' | 'revoked' | 'error'

export interface GoogleConnection {
  id: string
  orgId: string
  googleEmail: string
  gbpAccounts: { name: string; accountName: string }[]
  status: ConnectionStatus
  lastError: string | null
  connectedAt: string
}

/** GBP の locations.list で取得できる取込候補 */
export interface GbpLocation {
  connectionId: string
  /** 取込時に店舗へ保存する GBP アカウント名（accounts/...）。モックでは省略 */
  accountName?: string
  locationName: string
  title: string
  address: string
  placeId: string | null
  lat: number
  lng: number
}

/** 取込画面用: 取込済みか・取込可能か（placeId があるか）を付けた候補 */
export interface GbpLocationCandidate extends GbpLocation {
  isImported: boolean
  isImportable: boolean
}

export type StoreStatus = 'active' | 'archived'

export interface Store {
  id: string
  orgId: string
  name: string
  address: string
  lat: number
  lng: number
  connectionId: string | null
  gbpLocationName: string | null
  placeId: string
  reviewUrl: string
  status: StoreStatus
}

export type QuestionType = 'rating' | 'nps' | 'single' | 'multi' | 'text'

export interface QuestionOption {
  id: string
  label: string
}

export interface Question {
  id: string
  type: QuestionType
  label: string
  isRequired: boolean
  options: QuestionOption[]
  useForReviewDraft: boolean
}

export type Comparator = 'eq' | 'neq' | 'gte' | 'lte' | 'includes' | 'notIncludes' | 'notEmpty'

export interface RedirectCondition {
  id: string
  questionId: string
  comparator: Comparator
  value: number | string | null
}

export interface RedirectRule {
  operator: 'and' | 'or'
  conditions: RedirectCondition[]
}

export interface ReviewDraftSettings {
  isEnabled: boolean
  tone: 'casual' | 'polite'
  length: 'short' | 'medium'
  storeHighlights: string[]
  ngWords: string[]
}

export interface SurveyDesign {
  intro: string
  thanksMessage: string
}

/** 編集中の下書きと公開版で共通の中身 */
export interface SurveyContent {
  questions: Question[]
  redirectRule: RedirectRule
  reviewDraftSettings: ReviewDraftSettings
  design: SurveyDesign
}

export type SurveyStatus = 'draft' | 'published' | 'paused' | 'closed'

/** 公開管理の状態操作 */
export type SurveyStatusAction = 'pause' | 'resume' | 'close'

export interface PublishPeriod {
  startAt: string | null
  endAt: string | null
}

export interface Survey {
  id: string
  orgId: string
  storeId: string
  title: string
  status: SurveyStatus
  publicSlug: string
  draft: SurveyContent
  currentVersion: number | null
  hasUnpublishedChanges: boolean
  publishPeriod: PublishPeriod
  createdAt: string
  updatedAt: string
}

export interface SurveyVersion {
  orgId: string
  surveyId: string
  version: number
  content: SurveyContent
  publishedBy: string
  publishedAt: string
}

/** 回答画面が読む公開スナップショット。遷移条件と生成設定は含めない */
export interface PublicSurvey {
  slug: string
  orgId: string
  surveyId: string
  storeId: string
  version: number
  storeName: string
  questions: Question[]
  design: SurveyDesign
  status: 'published' | 'paused'
  publishPeriod: PublishPeriod
}

export type AnswerValue = number | string | string[]
export type Answers = Record<string, AnswerValue>

export interface ReviewDraft {
  text: string
  generatedAt: string
  regenerateCount: number
}

export interface SurveyResponse {
  id: string
  orgId: string
  surveyId: string
  storeId: string
  surveyVersion: number
  answers: Answers
  isEligible: boolean
  reviewDraft: ReviewDraft | null
  redirectedAt: string | null
  createdAt: string
}

export interface SearchLocation {
  lat: number
  lng: number
  label: string
}

export interface RankKeyword {
  id: string
  orgId: string
  storeId: string
  keyword: string
  searchLocation: SearchLocation
  isActive: boolean
  createdAt: string
  /** 手動計測の受け付けから完了まで値が入る（「計測中」の表示） */
  pendingCheckAt: string | null
}

export type RankStatus = 'ok' | 'error'
export type RankErrorCode = 'blocked' | 'timeout' | 'parse'
export type RankMatchedBy = 'placeId' | 'name' | null

/** 検索結果の 1 件（1〜20 位）。競合一覧にそのまま使う */
export interface RankResult {
  rank: number
  placeId: string | null
  name: string
  rating: number | null
  reviewCount: number | null
  category: string | null
}

/** organizations/{orgId}/rankSnapshots/{keywordId}_{YYYY-MM-DD}。直近 90 日を購読する */
export interface RankSnapshot {
  keywordId: string
  storeId: string
  /** YYYY-MM-DD（JST）。同日の再計測は上書き */
  checkedOn: string
  checkedAt: string
  trigger: 'scheduled' | 'manual'
  /** error は取得エラー（圏外とは別） */
  status: RankStatus
  errorCode: RankErrorCode | null
  /** null は圏外（21 位以下・一致なし）。error のときも null */
  rank: number | null
  matchedBy: RankMatchedBy
  resultCount: number
}

/** organizations/{orgId}/rankResults/{keywordId}_{YYYY-MM-DD}。日付を選んだときに読む */
export interface RankResultsDoc {
  keywordId: string
  checkedOn: string
  results: RankResult[]
}

export type RankSearchStatus = 'queued' | 'running' | 'done' | 'error'

/** organizations/{orgId}/rankSearches/{searchId}。その場計測（30 日で自動削除） */
export interface RankSearch {
  id: string
  orgId: string
  keyword: string
  searchLocation: SearchLocation
  storeId: string | null
  status: RankSearchStatus
  errorCode: RankErrorCode | null
  rank: number | null
  matchedBy: RankMatchedBy
  results: RankResult[]
  createdBy: string
  createdAt: string
  finishedAt: string | null
}

export interface UsageMonthly {
  orgId: string
  /** YYYYMM */
  month: string
  reviewDrafts: number
  rankChecks: number
  responses: number
}

export type GbpDayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** 時刻は 'HH:mm'（閉店 24:00 を含む） */
export interface GbpRegularHoursPeriod {
  openDay: GbpDayOfWeek
  openTime: string
  closeDay: GbpDayOfWeek
  closeTime: string
}

export interface GbpSpecialHoursPeriod {
  /** 'YYYY-MM-DD' */
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

/** GBP のプロフィールのキャッシュ（店名・住所・カテゴリは表示のみ） */
export interface GbpProfile {
  orgId: string
  storeId: string
  title: string
  address: string
  categories: string[]
  description: string
  primaryPhone: string
  websiteUri: string
  regularHours: GbpRegularHoursPeriod[]
  specialHours: GbpSpecialHoursPeriod[]
  syncedAt: string
}

/** プロフィールの編集内容。変更した項目だけを持つ */
export type GbpProfilePatch = Partial<Pick<GbpProfile, 'description' | 'primaryPhone' | 'websiteUri' | 'regularHours' | 'specialHours'>>

export interface GbpReview {
  id: string
  orgId: string
  storeId: string
  reviewName: string
  reviewerName: string
  reviewerPhotoUrl: string | null
  isAnonymous: boolean
  /** 1〜5。不明は null */
  starRating: number | null
  /** 評価だけの口コミは null */
  comment: string | null
  reviewCreatedAt: string
  reviewUpdatedAt: string
  reply: { comment: string; updatedAt: string } | null
  hasReply: boolean
}

export interface ReplyTemplate {
  id: string
  orgId: string
  name: string
  body: string
  createdAt: string
}

export type GbpPostTopicType = 'STANDARD' | 'EVENT' | 'OFFER'
/** FAILED は作成に失敗した投稿（本ツール独自） */
export type GbpPostState = 'LIVE' | 'PROCESSING' | 'REJECTED' | 'FAILED'
export type GbpCallToActionType = 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL'

/** 投稿の内容（作成時に送るもの） */
export interface GbpPostInput {
  topicType: GbpPostTopicType
  summary: string
  mediaUrl: string | null
  /** CALL は url を持たない。OFFER はボタンなし */
  callToAction: { actionType: GbpCallToActionType; url: string | null } | null
  /** EVENT / OFFER のみ。日時は店舗の現地時刻（'YYYY-MM-DDTHH:mm'） */
  event: { title: string; startAt: string; endAt: string } | null
  /** OFFER のみ。空文字は未設定 */
  offer: { couponCode: string; redeemOnlineUrl: string; termsConditions: string } | null
}

export interface GbpPost extends GbpPostInput {
  id: string
  orgId: string
  storeId: string
  /** 作成に失敗した投稿は null */
  postName: string | null
  state: GbpPostState
  searchUrl: string | null
  errorMessage: string | null
  createdAt: string
}

/** 一括処理の結果（部分失敗を含む） */
export interface BatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}
