/** 管理画面（ADMIN_APP_URL）の絶対 URL。path は / で始める */
export function appUrl(path: string): string {
  return `${(process.env.ADMIN_APP_URL ?? '').replace(/\/$/, '')}${path}`
}
