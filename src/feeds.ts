import type { Lang, PostListItem, Project } from './db'
import { postPath, xmlEscape } from './format'
import { LEGACY_HOME, type HomeState } from './home-state'
import { langPrefix, UI } from './i18n'

export function rss(siteUrl: string, siteName: string, posts: PostListItem[], lang: Lang = 'en'): string {
  const items = posts
    .map((p) => {
      const url = xmlEscape(siteUrl + postPath(p.kind, p.slug, p.lang))
      return `<item><title>${xmlEscape(p.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate>${
        p.summary ? `<description>${xmlEscape(p.summary)}</description>` : ''
      }<category>${p.kind}</category></item>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(siteName)}</title><link>${siteUrl}${langPrefix(lang)}</link><description>${UI[lang].feedDescription}</description><language>${lang}</language>${items}</channel></rss>`
}

// Pages that exist in both languages carry xhtml:link alternates (Google's hreflang-in-sitemap form);
// x-default is the English URL.
export function sitemap(siteUrl: string, posts: PostListItem[], projects: Project[], home: HomeState = LEGACY_HOME, hasAwards = false): string {
  const langs: Lang[] = ['en', 'tr']
  const entries: { lang: Lang; path: string; group: string }[] = []
  for (const lang of langs) {
    const pre = langPrefix(lang)
    for (const rest of ['', '/writing', '/notes']) {
      if (rest === '' && lang === 'tr' && !home.trIndexable) continue
      // Homes that are not a hreflang pair get separate groups, so they carry no alternates.
      const group = rest === '' && !home.paired ? `home-${lang}` : rest || '/'
      entries.push({ lang, path: pre + rest || '/', group })
    }
  }
  // Projects are English-only for now; the /tr project pages are noindex and stay out of the sitemap.
  entries.push({ lang: 'en', path: '/projects', group: '/projects' })
  if (hasAwards) entries.push({ lang: 'en', path: '/awards', group: '/awards' })
  for (const pr of projects) if (pr.has_case) entries.push({ lang: 'en', path: `/projects/${pr.slug}`, group: `/projects/${pr.slug}` })
  for (const p of posts) entries.push({ lang: p.lang, path: postPath(p.kind, p.slug, p.lang), group: postPath(p.kind, p.slug) })

  const byGroup = new Map<string, typeof entries>()
  for (const e of entries) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e])

  const link = (hreflang: string, path: string) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${xmlEscape(siteUrl + path)}"/>`
  const urls = entries
    .map((e) => {
      const siblings = byGroup.get(e.group) ?? []
      const en = siblings.find((s) => s.lang === 'en')
      const alternates =
        en && siblings.length > 1 ? siblings.map((s) => link(s.lang, s.path)).join('') + link('x-default', en.path) : ''
      return `<url><loc>${xmlEscape(siteUrl + e.path)}</loc>${alternates}</url>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`
}

// llms.txt: a plain index so language-model crawlers find the notes (https://llmstxt.org).
export function llmsTxt(siteUrl: string, siteName: string, posts: PostListItem[]): string {
  const section = (title: string, list: PostListItem[]) =>
    list.length
      ? `## ${title}\n\n${list.map((p) => `- [${p.title}](${siteUrl + postPath(p.kind, p.slug, p.lang)})${p.summary ? `: ${p.summary}` : ''}`).join('\n')}\n`
      : ''
  const language = (lang: Lang) => {
    const ui = UI[lang]
    const mine = posts.filter((p) => p.lang === lang)
    const suffix = lang === 'en' ? '' : ` (${ui.languageName})`
    return [
      section(ui.notes + suffix, mine.filter((p) => p.kind === 'note')),
      section(ui.writing + suffix, mine.filter((p) => p.kind === 'writing')),
    ].join('\n')
  }
  return [`# ${siteName}\n`, `> ${UI.en.llmsDescription}\n> ${UI.tr.llmsDescription}\n`, language('en'), language('tr')].join('\n')
}
