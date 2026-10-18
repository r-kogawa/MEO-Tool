// LP のヘッダーとフッターで共有するページ内リンク。/terms など LP 以外でも同じレイアウトを使うため / から書く
export interface LandingNavItem {
  label: string
  href: string
}

export function useLandingNav(): LandingNavItem[] {
  return [
    { label: '機能', href: '/#features' },
    { label: '導入の流れ', href: '/#steps' },
    { label: 'よくある質問', href: '/#faq' },
  ]
}
