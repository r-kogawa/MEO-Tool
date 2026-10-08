import { fail } from '../shared/errors'
import type { SurveyStatus, SurveyStatusAction } from './types'

// 公開管理の状態の移り方（モック app/utils/mock/functions/surveys.ts の updateSurveyStatusFunc と同じ）

const TRANSITIONS: Record<SurveyStatusAction, { from: SurveyStatus[]; to: SurveyStatus }> = {
  pause: { from: ['published'], to: 'paused' },
  resume: { from: ['paused'], to: 'published' },
  close: { from: ['published', 'paused'], to: 'closed' },
}

export function nextSurveyStatus(current: SurveyStatus, action: SurveyStatusAction): SurveyStatus {
  const transition = TRANSITIONS[action]
  if (!transition.from.includes(current)) fail('failed-precondition', 'この状態からは変更できません。')
  return transition.to
}

/** 回答画面の公開データ（publicSurveys）を持つ状態 */
export function isPublicStatus(status: SurveyStatus): status is 'published' | 'paused' {
  return status === 'published' || status === 'paused'
}
