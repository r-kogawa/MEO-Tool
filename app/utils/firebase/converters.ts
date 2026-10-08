import type { User as AuthUser } from 'firebase/auth'
import type { DocumentData } from 'firebase/firestore'
import type { GbpPost, GbpProfile, GbpReview, GoogleConnection, Invitation, Member, Organization, PublicSurvey, PublishPeriod, RankKeyword, RankResultsDoc, RankSearch, RankSnapshot, ReplyTemplate, Store, Survey, SurveyResponse, SurveyVersion, User } from '~/types/domain'

// Firestore のドキュメントを app/types/domain.ts の型（日時は ISO 文字列）に変換する。

/** Timestamp / Date / ISO 文字列を ISO 文字列にする。サーバー時刻の確定前（null）は現在時刻 */
export function toIso(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
}

export function toUser(authUser: AuthUser): User {
  return {
    uid: authUser.uid,
    email: (authUser.email ?? '').toLowerCase(),
    displayName: authUser.displayName ?? authUser.email ?? '',
    isOperator: false,
  }
}

export function toOrganization(id: string, data: DocumentData): Organization {
  return {
    id,
    type: data.type,
    name: data.name,
    plan: data.plan,
    status: data.status,
    limits: data.limits,
    ownerUid: data.ownerUid,
    createdAt: toIso(data.createdAt),
    googleOAuthClient: data.googleOAuthClient
      ? { clientId: data.googleOAuthClient.clientId, configuredAt: toIso(data.googleOAuthClient.configuredAt) }
      : null,
  }
}

export function toMember(data: DocumentData): Member {
  return {
    orgId: data.orgId,
    uid: data.uid,
    role: data.role,
    storeIds: data.storeIds ?? [],
    email: data.email,
    displayName: data.displayName,
    joinedAt: toIso(data.joinedAt),
  }
}

/** 保存しているのはトークンのハッシュだけなので token は空文字（URL は作成直後にだけ表示できる） */
export function toInvitation(id: string, data: DocumentData): Invitation {
  return {
    id,
    orgId: data.orgId,
    email: data.email,
    role: data.role,
    storeIds: data.storeIds ?? [],
    status: data.status,
    token: '',
    expiresAt: toIso(data.expiresAt),
    invitedBy: data.invitedBy,
    createdAt: toIso(data.createdAt),
  }
}

export function toStore(id: string, orgId: string, data: DocumentData): Store {
  return {
    id,
    orgId,
    name: data.name,
    address: data.address ?? '',
    lat: data.location?.latitude ?? 0,
    lng: data.location?.longitude ?? 0,
    connectionId: data.connectionId ?? null,
    gbpLocationName: data.gbpLocationName ?? null,
    placeId: data.placeId ?? '',
    reviewUrl: data.reviewUrl ?? '',
    status: data.status ?? 'active',
  }
}

export function toGoogleConnection(id: string, orgId: string, data: DocumentData): GoogleConnection {
  return {
    id,
    orgId,
    googleEmail: data.googleEmail,
    gbpAccounts: data.gbpAccounts ?? [],
    status: data.status,
    lastError: data.lastError ?? null,
    connectedAt: toIso(data.connectedAt ?? data.createdAt),
  }
}

export function toGbpProfile(data: DocumentData): GbpProfile {
  return {
    orgId: data.orgId,
    storeId: data.storeId,
    title: data.title ?? '',
    address: data.address ?? '',
    categories: data.categories ?? [],
    description: data.description ?? '',
    primaryPhone: data.primaryPhone ?? '',
    websiteUri: data.websiteUri ?? '',
    regularHours: data.regularHours ?? [],
    specialHours: data.specialHours ?? [],
    syncedAt: toIso(data.syncedAt),
  }
}

export function toGbpReview(id: string, data: DocumentData): GbpReview {
  return {
    id,
    orgId: data.orgId,
    storeId: data.storeId,
    reviewName: data.reviewName,
    reviewerName: data.reviewerName ?? '匿名',
    reviewerPhotoUrl: data.reviewerPhotoUrl ?? null,
    isAnonymous: data.isAnonymous === true,
    starRating: data.starRating ?? null,
    comment: data.comment ?? null,
    reviewCreatedAt: toIso(data.reviewCreatedAt),
    reviewUpdatedAt: toIso(data.reviewUpdatedAt),
    reply: data.reply ? { comment: data.reply.comment, updatedAt: toIso(data.reply.updatedAt) } : null,
    hasReply: data.hasReply === true,
  }
}

export function toReplyTemplate(id: string, data: DocumentData): ReplyTemplate {
  return { id, orgId: data.orgId, name: data.name, body: data.body, createdAt: toIso(data.createdAt) }
}

export function toGbpPost(id: string, data: DocumentData): GbpPost {
  return {
    id,
    orgId: data.orgId,
    storeId: data.storeId,
    postName: data.postName ?? null,
    topicType: data.topicType,
    summary: data.summary ?? '',
    mediaUrl: data.mediaUrl ?? null,
    callToAction: data.callToAction ?? null,
    event: data.event ?? null,
    offer: data.offer ?? null,
    state: data.state,
    searchUrl: data.searchUrl ?? null,
    errorMessage: data.errorMessage ?? null,
    createdAt: toIso(data.createdAt),
  }
}

export function toRankKeyword(id: string, orgId: string, data: DocumentData): RankKeyword {
  return {
    id,
    orgId,
    storeId: data.storeId,
    keyword: data.keyword,
    searchLocation: data.searchLocation,
    isActive: data.isActive === true,
    createdAt: toIso(data.createdAt),
    pendingCheckAt: data.pendingCheckAt ? toIso(data.pendingCheckAt) : null,
  }
}

export function toRankSnapshot(data: DocumentData): RankSnapshot {
  return {
    keywordId: data.keywordId,
    storeId: data.storeId,
    checkedOn: data.checkedOn,
    checkedAt: toIso(data.checkedAt),
    trigger: data.trigger,
    status: data.status ?? 'ok',
    errorCode: data.errorCode ?? null,
    rank: data.rank ?? null,
    matchedBy: data.matchedBy ?? null,
    resultCount: data.resultCount ?? 0,
  }
}

export function toRankResults(data: DocumentData): RankResultsDoc {
  return { keywordId: data.keywordId, checkedOn: data.checkedOn, results: data.results ?? [] }
}

export function toRankSearch(id: string, orgId: string, data: DocumentData): RankSearch {
  return {
    id,
    orgId,
    keyword: data.keyword,
    searchLocation: data.searchLocation,
    storeId: data.storeId ?? null,
    status: data.status,
    errorCode: data.errorCode ?? null,
    rank: data.rank ?? null,
    matchedBy: data.matchedBy ?? null,
    results: data.results ?? [],
    createdBy: data.createdBy,
    createdAt: toIso(data.createdAt),
    finishedAt: data.finishedAt ? toIso(data.finishedAt) : null,
  }
}

/** 公開期間（Firestore では Timestamp | null） */
function toPublishPeriod(value: DocumentData | undefined): PublishPeriod {
  return {
    startAt: value?.startAt ? toIso(value.startAt) : null,
    endAt: value?.endAt ? toIso(value.endAt) : null,
  }
}

export function toSurvey(id: string, orgId: string, data: DocumentData): Survey {
  return {
    id,
    orgId,
    storeId: data.storeId,
    title: data.title,
    status: data.status,
    publicSlug: data.publicSlug,
    draft: data.draft,
    currentVersion: data.currentVersion ?? null,
    hasUnpublishedChanges: data.hasUnpublishedChanges === true,
    publishPeriod: toPublishPeriod(data.publishPeriod),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

export function toSurveyVersion(data: DocumentData): SurveyVersion {
  return {
    orgId: data.orgId,
    surveyId: data.surveyId,
    version: data.version,
    content: data.content,
    publishedBy: data.publishedBy,
    publishedAt: toIso(data.publishedAt),
  }
}

/** ipHash はサーバーだけが使うので読まない。文面の生成は作らないため reviewDraft は常に null */
export function toSurveyResponse(id: string, data: DocumentData): SurveyResponse {
  return {
    id,
    orgId: data.orgId,
    surveyId: data.surveyId,
    storeId: data.storeId,
    surveyVersion: data.surveyVersion,
    answers: data.answers ?? {},
    isEligible: data.isEligible === true,
    reviewDraft: null,
    redirectedAt: data.redirectedAt ? toIso(data.redirectedAt) : null,
    createdAt: toIso(data.createdAt),
  }
}

export function toPublicSurvey(data: DocumentData): PublicSurvey {
  return {
    slug: data.slug,
    orgId: data.orgId,
    surveyId: data.surveyId,
    storeId: data.storeId,
    version: data.version,
    storeName: data.storeName ?? '',
    questions: data.questions ?? [],
    design: data.design,
    status: data.status,
    publishPeriod: toPublishPeriod(data.publishPeriod),
  }
}
