// robots.txt。ログインが必要な画面は noindex（ページの meta と firebase.json の X-Robots-Tag）で検索結果から外す。
// Disallow でクロールを止めると noindex 自体が読まれなくなるため、ここでは止めない
export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig(event).public
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  const lines = ['User-Agent: *', 'Disallow:']
  if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`)
  return `${lines.join('\n')}\n`
})
