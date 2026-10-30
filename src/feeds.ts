import type { PostListItem, Project } from './db'
import { postPath, xmlEscape } from './format'

export function rss(siteUrl: string, siteName: string, posts: PostListItem[]): string {
  const items = posts
    .map((p) => {
      const url = xmlEscape(siteUrl + postPath(p.kind, p.slug))
      return `<item><title>${xmlEscape(p.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate>${
        p.summary ? `<description>${xmlEscape(p.summary)}</description>` : ''
      }<category>${p.kind}</category></item>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(siteName)}</title><link>${siteUrl}</link><description>Field notes, projects and essays.</description>${items}</channel></rss>`
}

export function sitemap(siteUrl: string, posts: PostListItem[], projects: Project[]): string {
  const paths = ['/', '/writing', '/notes', '/projects', ...posts.map((p) => postPath(p.kind, p.slug))]
  for (const pr of projects) if (pr.has_case) paths.push(`/projects/${pr.slug}`)
  const urls = paths.map((p) => `<url><loc>${xmlEscape(siteUrl + p)}</loc></url>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
}

// llms.txt: a plain index so language-model crawlers find the notes (https://llmstxt.org).
export function llmsTxt(siteUrl: string, siteName: string, posts: PostListItem[]): string {
  const section = (title: string, list: PostListItem[]) =>
    list.length
      ? `## ${title}\n\n${list.map((p) => `- [${p.title}](${siteUrl + postPath(p.kind, p.slug)})${p.summary ? `: ${p.summary}` : ''}`).join('\n')}\n`
      : ''
  return [
    `# ${siteName}\n`,
    '> Backend and AI systems engineer. Field notes on problems that are not documented elsewhere, projects and essays.\n',
    section('Notes', posts.filter((p) => p.kind === 'note')),
    section('Writing', posts.filter((p) => p.kind === 'writing')),
  ].join('\n')
}
