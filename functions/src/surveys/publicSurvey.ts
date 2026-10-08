import type { CollectionReference, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore'
import type { Caller } from '../shared/auth'
import { fail } from '../shared/errors'
import { requireMember, requireOrg, requireStoreAccess, type MemberDoc } from '../shared/members'
import type { StoredPeriod } from './period'
import { isPublicStatus } from './status'
import type { Question, SurveyContent, SurveyDesign, SurveyStatus } from './types'

// アンケートの Firestore 上の形と、回答画面の公開データ（publicSurveys/{slug}）の作り直し

/** organizations/{orgId}/surveys/{surveyId} */
export interface SurveyDoc {
  orgId: string
  storeId: string
  title: string
  status: SurveyStatus
  publicSlug: string
  draft: SurveyContent
  currentVersion: number | null
  hasUnpublishedChanges: boolean
  publishPeriod: StoredPeriod
}

/** publicSurveys/{slug}。未ログインでも読めるため、遷移ルール・生成設定・口コミ URL は含めない */
export interface PublicSurveyDoc {
  slug: string
  orgId: string
  surveyId: string
  storeId: string
  version: number
  storeName: string
  questions: Question[]
  design: SurveyDesign
  status: 'published' | 'paused'
  publishPeriod: StoredPeriod
}

export function surveysOf(db: Firestore, orgId: string): CollectionReference {
  return db.collection(`organizations/${orgId}/surveys`)
}

/** 公開版。staff の購読（storeId in）のため、組織直下に {surveyId}_{n} で置く */
export function versionRef(db: Firestore, orgId: string, surveyId: string, version: number): DocumentReference {
  return db.doc(`organizations/${orgId}/surveyVersions/${surveyId}_${version}`)
}

export function publicSurveyRef(db: Firestore, slug: string): DocumentReference {
  return db.doc(`publicSurveys/${slug}`)
}

/** アンケートを読み、権限を確かめる（組織のメンバー。staff は担当店舗のみ）。tx を渡すとトランザクション内で読む */
export async function loadSurvey(
  db: Firestore,
  caller: Caller,
  orgId: string,
  surveyId: string,
  tx?: Transaction,
): Promise<{ ref: DocumentReference; survey: SurveyDoc; member: MemberDoc }> {
  await requireOrg(db, orgId, tx)
  const member = await requireMember(db, orgId, caller.uid, undefined, tx)
  const ref = surveysOf(db, orgId).doc(surveyId)
  const snapshot = tx ? await tx.get(ref) : await ref.get()
  if (!snapshot.exists) fail('not-found', 'アンケートが見つかりません。')
  const survey = snapshot.data() as SurveyDoc
  requireStoreAccess(member, survey.storeId)
  return { ref, survey, member }
}

/** 公開データの作り直しに使う、公開版の中身と店舗名を読む（トランザクションの書き込みより前に呼ぶ） */
export async function readPublicSource(
  tx: Transaction,
  db: Firestore,
  orgId: string,
  surveyId: string,
  survey: SurveyDoc,
): Promise<{ content: SurveyContent | null; storeName: string }> {
  const store = await tx.get(db.doc(`organizations/${orgId}/stores/${survey.storeId}`))
  const storeName = (store.get('name') as string | undefined) ?? ''
  if (survey.currentVersion === null) return { content: null, storeName }
  const version = await tx.get(versionRef(db, orgId, surveyId, survey.currentVersion))
  return { content: version.exists ? (version.get('content') as SurveyContent) : null, storeName }
}

/** 公開データを survey の状態に合わせて作り直す。公開中・停止中でなければ削除する */
export function writePublicSurvey(
  tx: Transaction,
  db: Firestore,
  surveyId: string,
  survey: SurveyDoc,
  content: SurveyContent | null,
  storeName: string,
): void {
  const ref = publicSurveyRef(db, survey.publicSlug)
  if (!content || survey.currentVersion === null || !isPublicStatus(survey.status)) {
    tx.delete(ref)
    return
  }
  const data: PublicSurveyDoc = {
    slug: survey.publicSlug,
    orgId: survey.orgId,
    surveyId,
    storeId: survey.storeId,
    version: survey.currentVersion,
    storeName,
    questions: content.questions,
    design: content.design,
    status: survey.status,
    publishPeriod: survey.publishPeriod,
  }
  tx.set(ref, data)
}
