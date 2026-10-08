import type { MemberRole, OrgType } from './domain'

declare module '#app' {
  interface PageMeta {
    /** このページを開けるロール。未指定なら全メンバー */
    roles?: MemberRole[]
    /** このページを開ける組織種別。未指定なら両方 */
    orgTypes?: OrgType[]
  }
}

export {}
