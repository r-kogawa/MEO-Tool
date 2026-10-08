export type AccessTokenProvider = () => Promise<string>

export interface GbpClientOptions {
  /** 呼び出しごとに有効なアクセストークンを返す関数 */
  getAccessToken: AccessTokenProvider
  /** テストで差し替える。既定は globalThis.fetch */
  fetch?: typeof fetch
  /** 429 / 5xx の再試行設定。既定 { maxRetries: 3, baseDelayMs: 500 } */
  retry?: { maxRetries: number; baseDelayMs: number }
  /** テストで待機を省略するために差し替える */
  sleep?: (ms: number) => Promise<void>
  /** 1 回の HTTP リクエストのタイムアウト（ミリ秒）。既定 30000 */
  timeoutMs?: number
}

export type GbpAccountType = 'ACCOUNT_TYPE_UNSPECIFIED' | 'PERSONAL' | 'LOCATION_GROUP' | 'USER_GROUP' | 'ORGANIZATION'

export interface GbpAccount {
  /** accounts/{accountId} */
  name: string
  accountName?: string
  type?: GbpAccountType
  role?: string
  verificationState?: string
}

export type GbpDayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** 省略されたフィールドは 0 として扱われる（00:00 は {} で返ることがある） */
export interface GbpTimeOfDay {
  hours?: number
  minutes?: number
}

export interface GbpDate {
  year: number
  month: number
  day: number
}

export interface GbpTimePeriod {
  openDay: GbpDayOfWeek
  openTime: GbpTimeOfDay
  closeDay: GbpDayOfWeek
  closeTime: GbpTimeOfDay
}

export interface GbpSpecialHourPeriod {
  startDate: GbpDate
  openTime?: GbpTimeOfDay
  endDate?: GbpDate
  closeTime?: GbpTimeOfDay
  closed?: boolean
}

export interface GbpPostalAddress {
  regionCode?: string
  postalCode?: string
  administrativeArea?: string
  locality?: string
  addressLines?: string[]
}

export interface GbpCategory {
  name: string
  displayName?: string
}

export interface GbpLocation {
  /** locations/{locationId} */
  name: string
  title?: string
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  categories?: { primaryCategory?: GbpCategory; additionalCategories?: GbpCategory[] }
  storefrontAddress?: GbpPostalAddress
  websiteUri?: string
  regularHours?: { periods: GbpTimePeriod[] }
  specialHours?: { specialHourPeriods: GbpSpecialHourPeriod[] }
  latlng?: { latitude: number; longitude: number }
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string }
  profile?: { description: string }
}

/** updateLocation で送る内容。name と metadata は出力専用のため含めない */
export type GbpLocationPatch = Omit<Partial<GbpLocation>, 'name' | 'metadata'>

export type GbpStarRating = 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'

export interface GbpReviewReply {
  /** 4096 バイト以内 */
  comment: string
  updateTime?: string
}

export interface GbpReview {
  /** accounts/{a}/locations/{l}/reviews/{reviewId} */
  name: string
  reviewId: string
  reviewer: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean }
  starRating: GbpStarRating
  /** 評価だけの口コミでは省略される */
  comment?: string
  createTime: string
  updateTime: string
  reviewReply?: GbpReviewReply
}

export interface GbpListReviewsOptions {
  /** 1〜50。既定 50 */
  pageSize?: number
  pageToken?: string
  /** 'updateTime desc'（既定） / 'rating' / 'rating desc' */
  orderBy?: string
}

export interface GbpListReviewsResponse {
  reviews?: GbpReview[]
  averageRating?: number
  totalReviewCount?: number
  nextPageToken?: string
}

export type GbpLocalPostTopicType = 'STANDARD' | 'EVENT' | 'OFFER'

export type GbpCallToActionType = 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL'

export type GbpLocalPostState = 'LOCAL_POST_STATE_UNSPECIFIED' | 'REJECTED' | 'LIVE' | 'PROCESSING' | 'SCHEDULED' | 'RECURRING'

export interface GbpTimeInterval {
  startDate: GbpDate
  startTime?: GbpTimeOfDay
  endDate: GbpDate
  endTime?: GbpTimeOfDay
}

export interface GbpLocalPostInput {
  languageCode: string
  /** STANDARD では必須。EVENT / OFFER では省略できる */
  summary?: string
  topicType: GbpLocalPostTopicType
  /** CALL のときは url 不要 */
  callToAction?: { actionType: GbpCallToActionType; url?: string }
  /** 投稿で使えるのは sourceUrl（Google が取得できる公開 URL）のみ */
  media?: { mediaFormat: 'PHOTO'; sourceUrl: string }[]
  /** EVENT / OFFER で必須 */
  event?: { title: string; schedule: GbpTimeInterval }
  offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string }
}

export interface GbpLocalPost extends Omit<GbpLocalPostInput, 'topicType' | 'media'> {
  /** accounts/{a}/locations/{l}/localPosts/{postId} */
  name: string
  /** API は ALERT も返しうるため入力型より広い */
  topicType: GbpLocalPostTopicType | 'ALERT' | 'LOCAL_POST_TOPIC_TYPE_UNSPECIFIED'
  /** 応答では Google 上の URL（googleUrl）が入る */
  media?: { mediaFormat: 'PHOTO' | 'VIDEO'; sourceUrl?: string; googleUrl?: string }[]
  state?: GbpLocalPostState
  searchUrl?: string
  createTime?: string
  updateTime?: string
}
