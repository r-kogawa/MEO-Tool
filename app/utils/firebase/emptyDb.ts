import type { MockDb } from '~/utils/mock/seed'

/** 本物モードの DB の初期値。Firestore の購読結果で埋めていく */
export function createEmptyDb(): MockDb {
  return {
    users: [],
    organizations: [],
    members: [],
    invitations: [],
    googleConnections: [],
    gbpLocations: [],
    stores: [],
    surveys: [],
    surveyVersions: [],
    publicSurveys: [],
    responses: [],
    rankKeywords: [],
    rankSnapshots: [],
    rankResults: [],
    rankSearches: [],
    usage: [],
    gbpProfiles: [],
    gbpReviews: [],
    gbpPosts: [],
    replyTemplates: [],
  }
}
