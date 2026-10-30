import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { Post, PostListItem, Project, ProjectStatus, Tag } from './db'
import { formatDate, postPath } from './format'
import { isSafeHttpUrl } from './redirect'

// Cloudflare Web Analytics site token. It is public by design: every page embeds it.
const ANALYTICS_TOKEN = '72c1277b98af402da8e5b2a88edf77fd'

type LayoutProps = { title: string; description?: string; lang?: string; canonical?: string; children: Child }

export function Layout({ title, description, lang = 'en', canonical, children }: LayoutProps) {
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {description ? <meta name="description" content={description} /> : null}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        <link rel="alternate" type="application/rss+xml" title="RSS" href="/rss.xml" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/theme.js"></script>
        <script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token: ANALYTICS_TOKEN })}
        ></script>
      </head>
      <body>
        <header class="site-header">
          <a class="wordmark" href="/" aria-label="Home">
            <span class="accent">~/</span>ismail
          </a>
          <nav aria-label="Main">
            <a href="/writing">Writing</a>
            <a href="/notes">Notes</a>
            <a href="/projects">Projects</a>
            <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch color theme">
              ◐
            </button>
          </nav>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          <a href="/rss.xml">RSS</a>
          <a href="https://github.com/ismailtrm">GitHub</a>
          <a href="https://www.linkedin.com/in/ismailtarim">LinkedIn</a>
          <span class="copy">© {new Date().getUTCFullYear()} İsmail Tarım</span>
        </footer>
      </body>
    </html>
  )
}

export function PostList({ posts }: { posts: PostListItem[] }) {
  if (!posts.length) return <p class="muted">Nothing published here yet.</p>
  return (
    <ul class="post-list">
      {posts.map((p) => (
        <li>
          <time datetime={p.published_at}>{formatDate(p.published_at)}</time>
          <a href={postPath(p.kind, p.slug)} lang={p.lang}>
            {p.title}
          </a>
        </li>
      ))}
    </ul>
  )
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  merged: 'merged',
  under_review: 'under review',
  submitted: 'submitted',
  published: 'published',
  personal: 'personal tool',
}

export function ProjectLedger({ projects }: { projects: Project[] }) {
  if (!projects.length) return <p class="muted">No projects listed yet.</p>
  return (
    <div class="table-wrap">
      <table class="ledger">
        <thead>
          <tr>
            <th scope="col">Work</th>
            <th scope="col">Year</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr>
              <td>
                {p.has_case ? <a href={`/projects/${p.slug}`}>{p.name}</a> : p.name}
                <span class="muted block">{p.summary}</span>
              </td>
              <td class="num">{p.year}</td>
              <td class={`status status-${p.status}`}>{STATUS_LABEL[p.status]}</td>
              <td>
                <span class="badges">
                  {p.links.filter((l) => isSafeHttpUrl(l.url)).map((l) => (
                    <a class="badge" href={l.url} translate="no">
                      {l.label}
                    </a>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TagLinks({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null
  return (
    <p class="tags">
      {tags.map((t) => (
        <a href={`/tags/${t.slug}`}>#{t.name}</a>
      ))}
    </p>
  )
}

export function Article({ post }: { post: Post }) {
  const note = post.note
  return (
    <article class="post" lang={post.lang}>
      <p class="muted">
        {post.kind === 'note' ? 'Field note' : 'Writing'}, <time datetime={post.published_at}>{formatDate(post.published_at)}</time>
      </p>
      <h1>{post.title}</h1>
      {note ? (
        <aside class="answer" aria-label="Short answer">
          <p>
            <strong>Symptom:</strong> <code translate="no">{note.symptom}</code>
          </p>
          <p>
            <strong>Fix:</strong> {note.fix}
          </p>
          <p class="verified" translate="no">
            verified {note.verified_at.slice(0, 10)}:{' '}
            {Object.entries(note.environment)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}
          </p>
        </aside>
      ) : null}
      {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
      <div class="prose">{raw(post.body_html)}</div>
      <TagLinks tags={post.tags} />
    </article>
  )
}
