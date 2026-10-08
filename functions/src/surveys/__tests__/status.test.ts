import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicStatus, nextSurveyStatus } from '../status'
import type { SurveyStatus, SurveyStatusAction } from '../types'

test('nextSurveyStatus: モック（surveys.ts:115-119）の移り方', () => {
  const allowed: [SurveyStatus, SurveyStatusAction, SurveyStatus][] = [
    ['published', 'pause', 'paused'],
    ['paused', 'resume', 'published'],
    ['published', 'close', 'closed'],
    ['paused', 'close', 'closed'],
  ]
  for (const [from, action, to] of allowed) assert.equal(nextSurveyStatus(from, action), to)
})

test('nextSurveyStatus: それ以外の 8 通りは failed-precondition', () => {
  const denied: [SurveyStatus, SurveyStatusAction][] = [
    ['draft', 'pause'], ['draft', 'resume'], ['draft', 'close'],
    ['published', 'resume'], ['paused', 'pause'],
    ['closed', 'pause'], ['closed', 'resume'], ['closed', 'close'],
  ]
  for (const [from, action] of denied) {
    assert.throws(() => nextSurveyStatus(from, action), { code: 'failed-precondition', message: 'この状態からは変更できません。' })
  }
})

test('isPublicStatus: 公開中と停止中だけが回答画面の公開データを持つ', () => {
  assert.deepEqual((['draft', 'published', 'paused', 'closed'] as SurveyStatus[]).map(isPublicStatus), [false, true, true, false])
})
