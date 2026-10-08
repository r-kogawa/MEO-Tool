import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import type { PublicContext } from '../shared/callable'
import { fail } from '../shared/errors'
import { asObject, requireId } from '../shared/validation'
import { isWithinPeriod, toPeriod } from '../surveys/period'
import { publicSurveyRef, versionRef, type PublicSurveyDoc } from '../surveys/publicSurvey'
import type { SurveyContent } from '../surveys/types'
import { requireAnswers } from './answers'
import { evaluateRedirectRule } from './evaluateRedirectRule'
import { getIpHashSalt, hashIp } from './ipHash'
import { RATE_LIMIT_TTL_MS, nextRateLimitHits } from './rateLimit'
import { addResponseUsage } from './usage'

// responses/ … 回答の受付と Google 口コミへの遷移の記録（docs/04-features.md F-10〜F-13。ログイン不要）

const CLOSED_MESSAGE = '現在このアンケートは受け付けていません。'

/** 現在時刻と IP ハッシュのソルト。テストで差し替える */
export interface ResponseDeps {
  now(): Date
  ipHashSalt(): string
}

export const defaultResponseDeps: ResponseDeps = { now: () => new Date(), ipHashSalt: getIpHashSalt }

export interface PostSurveyResponseResult {
  responseId: string
  isEligible: boolean
  /** 条件を満たしたときだけ店舗の口コミ URL */
  reviewUrl: string | null
}

/**
 * 回答を受け付ける。再送の確認・受付状態と期間・回答の検証・レート制限・遷移ルールの判定・保存・使用回数の加算を
 * 1 つのトランザクションで行う
 */
export async function postSurveyResponseFunc(
  db: Firestore,
  data: unknown,
  context: PublicContext,
  deps: ResponseDeps = defaultResponseDeps,
): Promise<PostSurveyResponseResult> {
  const input = asObject(data)
  const slug = requireId(input.slug, 'アンケートの URL')
  const submissionId = requireId(input.submissionId, '回答 ID')
  const now = deps.now()
  const ipHash = hashIp(deps.ipHashSalt(), context.ip)

  return db.runTransaction(async (tx) => {
    const found = await tx.get(publicSurveyRef(db, slug))
    if (!found.exists) fail('failed-precondition', CLOSED_MESSAGE)
    const survey = found.data() as PublicSurveyDoc
    const responseRef = db.doc(`organizations/${survey.orgId}/responses/${submissionId}`)
    const existing = await tx.get(responseRef)
    const store = await tx.get(db.doc(`organizations/${survey.orgId}/stores/${survey.storeId}`))
    // reviewUrl は回答に保存しない。条件を満たしたときだけ店舗から読んで返す
    const resultOf = (isEligible: boolean): PostSurveyResponseResult => ({
      responseId: submissionId,
      isEligible,
      reviewUrl: isEligible ? (store.get('reviewUrl') as string | undefined) || null : null,
    })

    // 再送（同じ submissionId）は、受付を止めた後でも保存済みの結果を返す
    if (existing.exists) {
      if (existing.get('surveyId') !== survey.surveyId) fail('already-exists', 'この回答はすでに送信されています。')
      return resultOf(existing.get('isEligible') === true)
    }
    if (survey.status !== 'published') fail('failed-precondition', CLOSED_MESSAGE)
    if (!isWithinPeriod(toPeriod(survey.publishPeriod), now)) fail('failed-precondition', '回答の受付期間外です。')

    // 遷移ルールは回答画面に渡していないため、公開版から読む
    const version = await tx.get(versionRef(db, survey.orgId, survey.surveyId, survey.version))
    if (!version.exists) fail('not-found', 'アンケートが見つかりません。')
    const content = version.get('content') as SurveyContent
    const answers = requireAnswers(content.questions, input.answers)

    const limitRef = db.doc(`rateLimits/${slug}_${ipHash}`)
    const stored = ((await tx.get(limitRef)).get('hits') ?? []) as Timestamp[]
    const hits = nextRateLimitHits(stored.map(hit => hit.toDate()), now)

    const isEligible = evaluateRedirectRule(content.redirectRule, answers)
    // expireAt は Firestore の TTL で古い rateLimits を消すための印（最後の受付から 1 日後）
    tx.set(limitRef, { hits, expireAt: new Date(now.getTime() + RATE_LIMIT_TTL_MS) })
    tx.create(responseRef, {
      orgId: survey.orgId,
      surveyId: survey.surveyId,
      storeId: survey.storeId,
      surveyVersion: survey.version,
      answers,
      isEligible,
      reviewDraft: null,
      redirectedAt: null,
      createdAt: now,
      ipHash,
    })
    addResponseUsage(tx, db, survey.orgId, now)
    return resultOf(isEligible)
  })
}

/** 「Google に口コミを書く」を押したことの記録。条件を満たした回答だけ、最初の 1 回を残す。実際に投稿されたかは分からない */
export async function postReviewRedirectFunc(db: Firestore, data: unknown, deps: ResponseDeps = defaultResponseDeps): Promise<void> {
  const input = asObject(data)
  const slug = requireId(input.slug, 'アンケートの URL')
  const submissionId = requireId(input.submissionId, '回答 ID')
  const survey = await publicSurveyRef(db, slug).get()
  if (!survey.exists) return
  const ref = db.doc(`organizations/${survey.get('orgId')}/responses/${submissionId}`)
  await db.runTransaction(async (tx) => {
    const response = await tx.get(ref)
    if (!response.exists || response.get('surveyId') !== survey.get('surveyId')) return
    if (response.get('isEligible') !== true || response.get('redirectedAt')) return
    tx.update(ref, { redirectedAt: deps.now() })
  })
}
