import { logger, setGlobalOptions } from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { callable, publicCallable } from "./shared/callable";
import { createOrganizationFunc } from "./identity/createOrganization";
import { createAccountFunc } from "./identity/createAccount";
import { externalApi } from "./shared/externalApi";
import { appUrl } from "./shared/appUrl";
import { defineSecret } from "firebase-functions/params";
import {
  createInvitationFunc,
  getInvitationFunc,
  updateInvitationAcceptFunc,
  updateInvitationRevokeFunc,
} from "./identity/invitations";
import { deleteMemberFunc, updateMemberRoleFunc, updateOrganizationNameFunc } from "./identity/members";
import { getFirestore } from "firebase-admin/firestore";
import { createGoogleAuthUrlFunc, deleteGoogleConnectionFunc, handleGoogleOAuthCallback } from "./google/connect";
import { deleteGoogleOAuthClientFunc, getGoogleOAuthConfigFunc, updateGoogleOAuthClientFunc } from "./google/oauthClient";
import { createStoresFromGbpFunc, getGbpLocationsFunc, updateStoreArchiveFunc } from "./stores/stores";
import { onSchedule } from "firebase-functions/scheduler";
import { onTaskDispatched } from "firebase-functions/tasks";
import { createRankKeywordFunc, deleteRankKeywordFunc, postRankCheckFunc, updateRankKeywordActiveFunc } from "./rankings/keywords";
import { createRankSearchFunc } from "./rankings/searches";
import { runScheduledRankCheck } from "./rankings/scheduled";
import { RANK_MAX_ATTEMPTS, parseRankTask, runRankTask } from "./rankings/worker";
import { defaultRankDeps } from "./rankings/rankDeps";
import type { RankTask } from "./rankings/types";
import { updateGbpProfileFunc, updateGbpProfilesSyncFunc } from "./gbp/profiles";
import { deleteGbpReviewReplyFunc, runScheduledReviewsSync, updateGbpReviewReplyFunc, updateGbpReviewsSyncFunc } from "./gbp/reviews";
import { createGbpPostsFunc, deleteGbpPostFunc, updateGbpPostsSyncFunc } from "./gbp/posts";
import { createReplyTemplateFunc, deleteReplyTemplateFunc, updateReplyTemplateFunc } from "./gbp/templates";
import {
  createSurveyCopyFunc,
  createSurveyFunc,
  updateSurveyDraftFunc,
  updateSurveyPeriodFunc,
  updateSurveyPublishFunc,
  updateSurveySlugFunc,
  updateSurveyStatusFunc,
} from "./surveys/surveys";
import { getResponsesCsvFunc } from "./surveys/responsesCsv";
import { postReviewRedirectFunc, postSurveyResponseFunc } from "./responses/responses";

const env = process.env;
const serviceAccount = require("../serviceAccount.json");

initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
  storageBucket: env.STORAGE_BUCKET,
});

setGlobalOptions({ region: "asia-northeast1" });

// identity/ … 組織・招待・メンバー（docs/04-features.md F-01, F-03）
export const createOrganization = callable(createOrganizationFunc);
export const createInvitation = callable(createInvitationFunc);
export const getInvitation = publicCallable(getInvitationFunc);
export const updateInvitationAccept = callable(updateInvitationAcceptFunc);
export const updateInvitationRevoke = callable(updateInvitationRevokeFunc);
export const updateMemberRole = callable(updateMemberRoleFunc);
export const deleteMember = callable(deleteMemberFunc);
export const updateOrganizationName = callable(updateOrganizationNameFunc);
// 外部システムからのアカウント作成（Authorization: Bearer <ACCOUNT_API_KEY> の POST）
export const createAccount = externalApi(defineSecret("ACCOUNT_API_KEY"), (db, data) => createAccountFunc(db, data));

// google/ … OAuth クライアント・Google 連携（F-04）
export const updateGoogleOAuthClient = callable(updateGoogleOAuthClientFunc);
export const deleteGoogleOAuthClient = callable(deleteGoogleOAuthClientFunc);
export const getGoogleOAuthConfig = callable(getGoogleOAuthConfigFunc);
export const createGoogleAuthUrl = callable(createGoogleAuthUrlFunc);
export const deleteGoogleConnection = callable((db, caller, data) => deleteGoogleConnectionFunc(db, caller, data));
export const googleOAuthCallback = onRequest(async (req, res) => {
  const pick = (value: unknown) => (typeof value === "string" ? value : undefined);
  try {
    const redirect = await handleGoogleOAuthCallback(getFirestore(), {
      code: pick(req.query.code),
      state: pick(req.query.state),
      error: pick(req.query.error),
    });
    res.redirect(302, redirect);
  }
  catch (error) {
    // 想定外の例外でも利用者を Functions のエラー画面で止めず、管理画面へ戻す
    logger.error("googleOAuthCallback で想定外のエラー", { error: String(error) });
    res.redirect(302, appUrl("/orgs?googleError=save_failed"));
  }
});

// stores/ … 店舗の取込・管理（F-05）
export const getGbpLocations = callable((db, caller, data) => getGbpLocationsFunc(db, caller, data));
export const createStoresFromGbp = callable((db, caller, data) => createStoresFromGbpFunc(db, caller, data));
export const updateStoreArchive = callable(updateStoreArchiveFunc);

// gbp/ … プロフィール・口コミ・投稿（docs/superpowers/specs/2026-10-07-gbp-integration-design.md 4.4）
const LONG_RUNNING = { timeoutSeconds: 300 };
export const updateGbpProfilesSync = callable((db, caller, data) => updateGbpProfilesSyncFunc(db, caller, data), LONG_RUNNING);
export const updateGbpProfile = callable((db, caller, data) => updateGbpProfileFunc(db, caller, data));
export const updateGbpReviewsSync = callable((db, caller, data) => updateGbpReviewsSyncFunc(db, caller, data), LONG_RUNNING);
export const updateGbpReviewReply = callable((db, caller, data) => updateGbpReviewReplyFunc(db, caller, data), LONG_RUNNING);
export const deleteGbpReviewReply = callable((db, caller, data) => deleteGbpReviewReplyFunc(db, caller, data));
export const createReplyTemplate = callable(createReplyTemplateFunc);
export const updateReplyTemplate = callable(updateReplyTemplateFunc);
export const deleteReplyTemplate = callable(deleteReplyTemplateFunc);
export const createGbpPosts = callable((db, caller, data) => createGbpPostsFunc(db, caller, data), LONG_RUNNING);
export const deleteGbpPost = callable((db, caller, data) => deleteGbpPostFunc(db, caller, data));
export const updateGbpPostsSync = callable((db, caller, data) => updateGbpPostsSyncFunc(db, caller, data), LONG_RUNNING);
export const scheduledGbpReviewsSync = onSchedule(
  { schedule: "0 6 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540 },
  async () => {
    // timeoutSeconds（540 秒）の手前で新しい組織への着手を止める
    const summary = await runScheduledReviewsSync(getFirestore(), undefined, { deadlineMs: Date.now() + 480_000 });
    logger.info("口コミの自動同期が完了しました", summary);
  },
);

// rankings/ … 順位計測（docs/superpowers/specs/2026-10-08-rank-scraping-design.md 3 章）
export const createRankKeyword = callable((db, caller, data) => createRankKeywordFunc(db, caller, data));
export const updateRankKeywordActive = callable(updateRankKeywordActiveFunc);
export const deleteRankKeyword = callable(deleteRankKeywordFunc);
export const postRankCheck = callable((db, caller, data) => postRankCheckFunc(db, caller, data));
export const createRankSearch = callable((db, caller, data) => createRankSearchFunc(db, caller, data));
// Chromium を載せるため 2GiB。1 インスタンス 1 件ずつ、全体で同時 2 件・5 秒に 1 件まで（Google マップへの負荷とブロックを抑える）
export const rankCheckWorker = onTaskDispatched<RankTask>(
  {
    memory: "2GiB",
    timeoutSeconds: 120,
    concurrency: 1,
    retryConfig: { maxAttempts: RANK_MAX_ATTEMPTS, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 0.2 },
  },
  (request) => runRankTask(getFirestore(), parseRankTask(request.data), defaultRankDeps, {
    isFinalAttempt: request.retryCount >= RANK_MAX_ATTEMPTS - 1,
  }),
);
export const scheduledRankCheck = onSchedule(
  { schedule: "0 4 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540 },
  async () => {
    const summary = await runScheduledRankCheck(getFirestore());
    if (summary.failed > 0) logger.error("順位の定期計測で投入に失敗したキーワードがあります", summary);
    else logger.info("順位の定期計測を投入しました", summary);
  },
);

// surveys/ … アンケートの管理（docs/superpowers/specs/2026-10-08-surveys-integration-design.md 2.1）
export const createSurvey = callable(createSurveyFunc);
export const createSurveyCopy = callable(createSurveyCopyFunc);
export const updateSurveyDraft = callable(updateSurveyDraftFunc);
export const updateSurveyPublish = callable(updateSurveyPublishFunc);
export const updateSurveyStatus = callable(updateSurveyStatusFunc);
export const updateSurveySlug = callable(updateSurveySlugFunc);
export const updateSurveyPeriod = callable(updateSurveyPeriodFunc);
export const getResponsesCsv = callable(getResponsesCsvFunc);

// responses/ … 回答の受付（2.2・2.3。ログイン不要）。deps は既定値を使うため、引数を明示して渡す
export const postSurveyResponse = publicCallable((db, data, context) => postSurveyResponseFunc(db, data, context));
export const postReviewRedirect = publicCallable((db, data) => postReviewRedirectFunc(db, data));
