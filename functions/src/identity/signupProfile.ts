import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { fail } from '../shared/errors'
import { requireOneOf, requirePhone } from '../shared/validation'

export const INDUSTRIES = ['salon', 'bodywork', 'beauty', 'unmanned', 'other'] as const
export const STORE_COUNTS = ['1', '2', '3-5', '6+'] as const

export type Industry = (typeof INDUSTRIES)[number]
export type StoreCount = (typeof STORE_COUNTS)[number]
export type SignupVia = 'signup' | 'externalApi'

export interface SignupSource {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  ref: string | null
  landingPath: string | null
  capturedAt: string | null
}

export interface SignupProfileInput {
  phone: string
  industry: Industry
  storeCount: StoreCount
  source: SignupSource | null
}

const SOURCE_MAX_LENGTHS: Record<keyof SignupSource, number> = {
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 100,
  ref: 100,
  landingPath: 200,
  capturedAt: 40,
}

export function signupProfileRef(db: Firestore, orgId: string): DocumentReference {
  return db.doc(`signupProfiles/${orgId}`)
}

function failSource(): never {
  return fail('invalid-argument', '登録経路の値が正しくありません。')
}

function parseSourceValue(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') failSource()
  const trimmed = value.trim()
  if (trimmed.length > maxLength) failSource()
  return trimmed === '' ? null : trimmed
}

function parseSource(value: unknown): SignupSource | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) failSource()
  const raw = value as Record<string, unknown>
  const source = {} as SignupSource
  for (const key of Object.keys(SOURCE_MAX_LENGTHS) as (keyof SignupSource)[]) {
    source[key] = parseSourceValue(raw[key], SOURCE_MAX_LENGTHS[key])
  }
  return Object.values(source).every(item => item === null) ? null : source
}

export function parseSignupProfileInput(input: Record<string, unknown>): SignupProfileInput {
  return {
    phone: requirePhone(input.phone),
    industry: requireOneOf(input.industry, INDUSTRIES, '業種'),
    storeCount: requireOneOf(input.storeCount, STORE_COUNTS, '運営店舗数'),
    source: parseSource(input.source),
  }
}
