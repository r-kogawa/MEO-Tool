// sitemap.xml。検索結果に出すのは LP（/）だけ。noindex のページはここに載せない
const INDEXABLE_PATHS = ['/']

export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig(event).public
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  const urls = INDEXABLE_PATHS.map(path => `  <url><loc>${siteUrl}${path}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
