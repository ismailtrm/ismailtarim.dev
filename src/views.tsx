import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { Achievement, FeaturedProject, HomeProfile, Lang, Post, PostListItem, Project, Tag } from './db'
import { formatDate, postPath } from './format'
import { homePath, langPrefix, otherLang, UI } from './i18n'
import { isSafeHttpUrl } from './redirect'

// Cloudflare Web Analytics site token. It is public by design: every page embeds it.
const ANALYTICS_TOKEN = '72c1277b98af402da8e5b2a88edf77fd'

// alternates: absolute URLs of the page in each language, given only where both exist.
type Alternates = Partial<Record<Lang, string>>

type LayoutProps = {
  title: string
  description?: string
  lang?: Lang
  canonical?: string
  alternates?: Alternates
  // Where the language switch goes when there are no alternates to take it from.
  switchTo?: string
  noindex?: boolean
  // The home page uses a wider container for its two columns.
  wide?: boolean
  // The site section this page belongs to, shown after the name as a path.
  section?: 'writing' | 'notes' | 'projects' | 'awards'
  children: Child
}

export function Layout({ title, description, lang = 'en', canonical, alternates, switchTo, noindex, wide, section, children }: LayoutProps) {
  const ui = UI[lang]
  const pre = langPrefix(lang)
  const other = otherLang(lang)
  const otherUrl = alternates?.[other]
  // The same page in the other language when it exists, else that language's home.
  const switchHref = switchTo ?? (otherUrl ? new URL(otherUrl).pathname : homePath(other))
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {description ? <meta name="description" content={description} /> : null}
        {noindex ? <meta name="robots" content="noindex" /> : null}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        {alternates?.en && alternates.tr ? (
          <>
            <link rel="alternate" hreflang="en" href={alternates.en} />
            <link rel="alternate" hreflang="tr" href={alternates.tr} />
            <link rel="alternate" hreflang="x-default" href={alternates.en} />
          </>
        ) : null}
        <link rel="alternate" type="application/rss+xml" title="RSS" href={`${pre}/rss.xml`} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/theme.js"></script>
        <script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token: ANALYTICS_TOKEN })}
        ></script>
      </head>
      <body class={wide ? 'wide' : undefined}>
        <header class="site-header">
          <span class="site-path">
            <a class="wordmark" href={homePath(lang)} aria-label={ui.home}>
              <span class="accent">~/</span>ismail
            </a>
            {section ? (
              <a class="wordmark crumb" href={`${pre}/${section}`}>
                /{section}
              </a>
            ) : null}
          </span>
          <nav aria-label={ui.mainNav}>
            <a href={`${pre}/writing`}>{ui.writing}</a>
            <a href={`${pre}/notes`}>{ui.notes}</a>
            <a href={`${pre}/projects`}>{ui.projects}</a>
            <a href={`${pre}/awards`}>{ui.awards}</a>
            <a class="lang-switch" href={switchHref} hreflang={other} lang={other} aria-label={UI[other].languageName}>
              {other.toUpperCase()}
            </a>
            <button type="button" class="theme-toggle" data-theme-toggle aria-label={ui.switchTheme}>
              ◐
            </button>
          </nav>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          <a href={`${pre}/rss.xml`}>RSS</a>
          <a href="https://github.com/ismailtrm">GitHub</a>
          <a href="https://www.linkedin.com/in/ismailtarim">LinkedIn</a>
          <span class="copyright">© {new Date().getUTCFullYear()} İsmail Tarım</span>
        </footer>
      </body>
    </html>
  )
}

export function PostList({ posts, lang = 'en' }: { posts: PostListItem[]; lang?: Lang }) {
  if (!posts.length) return <p class="muted">{UI[lang].noPosts}</p>
  return (
    <ul class="post-list">
      {posts.map((p) => (
        <li>
          <time datetime={p.published_at}>{formatDate(p.published_at, lang)}</time>
          <a href={postPath(p.kind, p.slug, p.lang)} lang={p.lang}>
            {p.title}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function ProjectLedger({ projects, lang = 'en' }: { projects: Project[]; lang?: Lang }) {
  const ui = UI[lang]
  if (!projects.length) return <p class="muted">{ui.noProjects}</p>
  return (
    <div class="table-wrap">
      <table class="ledger">
        <thead>
          <tr>
            <th scope="col">{ui.work}</th>
            <th scope="col">{ui.year}</th>
            <th scope="col">{ui.status}</th>
            <th scope="col">{ui.evidence}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr>
              <td>
                {p.has_case ? <a href={`${langPrefix(lang)}/projects/${p.slug}`}>{p.name}</a> : p.name}
                <span class="muted block">{p.summary}</span>
              </td>
              <td class="num">{p.year}</td>
              <td class={`status status-${p.status}`}>{p.status_label ?? ui.statusLabel[p.status]}</td>
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

function BadgeList({ items }: { items: { label: string; url: string }[] }) {
  const safe = items.filter((l) => isSafeHttpUrl(l.url))
  if (!safe.length) return null
  return (
    <span class="badges">
      {safe.map((l) => (
        <a class="badge" href={l.url} translate="no">
          {l.label}
        </a>
      ))}
    </span>
  )
}

function FeaturedItem({ project, lang }: { project: FeaturedProject; lang: Lang }) {
  const ui = UI[lang]
  // A case page wins, then a published post in its own language; the query already dropped unpublished posts.
  const href = project.has_case
    ? `${langPrefix(lang)}/projects/${project.slug}`
    : project.post
      ? postPath(project.post.kind, project.post.slug, project.post.lang)
      : null
  return (
    <li>
      <p class="featured-head">
        {href ? <a href={href}>{project.name}</a> : project.name}
        <span class="num muted">{project.year}</span>
        {project.status_label || project.status !== 'personal' ? <span class={`status status-${project.status}`}>{project.status_label ?? ui.statusLabel[project.status]}</span> : null}
      </p>
      <p class="muted">{project.summary}</p>
      <BadgeList items={project.links} />
    </li>
  )
}

function AchievementItem({ item }: { item: Achievement }) {
  return (
    <li class="record">
      <p class="record-result">
        {item.outcome ? <strong>{item.outcome}</strong> : null}
        <span class="num muted">{item.year}</span>
      </p>
      <div class="record-body">
        <h3>{item.title}</h3>
        {item.context || item.summary ? <p class="muted">{[item.context && `${item.context}.`, item.summary].filter(Boolean).join(' ')}</p> : null}
        <BadgeList items={item.links} />
      </div>
    </li>
  )
}

export function AchievementList({ items, lang = 'en' }: { items: Achievement[]; lang?: Lang }) {
  const ui = UI[lang]
  if (!items.length) return <p class="muted">{ui.noAwards}</p>
  return (
    <>
      {([['award', ui.awards], ['contribution', ui.contributions]] as const).map(([kind, heading]) => {
        const mine = items.filter((a) => a.kind === kind)
        return mine.length ? (
          <section>
            <h2>{heading}</h2>
            <ul class="record-list">
              {mine.map((a) => (
                <AchievementItem item={a} />
              ))}
            </ul>
          </section>
        ) : null
      })}
    </>
  )
}

type ProfileHomeProps = { profile: HomeProfile; projects: FeaturedProject[]; posts: PostListItem[]; lang: Lang }

export function ProfileHome({ profile, projects, posts, lang }: ProfileHomeProps) {
  const ui = UI[lang]
  const links = profile.links.filter((l) => isSafeHttpUrl(l.url) || /^mailto:[^\s@]+@[^\s@]+$/.test(l.url))
  return (
    <div class="home-grid">
      <aside class="profile-card">
        {profile.avatar ? (
          <img class="avatar" src={`/media/${profile.avatar.key}`} alt={profile.name} width={profile.avatar.width} height={profile.avatar.height} />
        ) : null}
        <h1>{profile.name}</h1>
        {profile.headline ? <p>{profile.headline}</p> : null}
        {profile.location ? <p class="muted">{profile.location}</p> : null}
        {links.length ? (
          <ul class="profile-links">
            {links.map((l) => (
              <li>
                <a href={l.url}>{l.label}</a>
              </li>
            ))}
          </ul>
        ) : null}
        <BadgeList items={profile.badges} />
      </aside>
      <div class="home-main">
        {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
        <div class="prose">{raw(profile.body_html)}</div>
        {projects.length ? (
          <section>
            <h2>{ui.selectedProjects}</h2>
            <ul class="featured-list">
              {projects.map((p) => (
                <FeaturedItem project={p} lang={lang} />
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h2>{ui.recent}</h2>
          <PostList posts={posts} lang={lang} />
        </section>
      </div>
    </div>
  )
}

function TagLinks({ tags, lang }: { tags: Tag[]; lang: Lang }) {
  if (!tags.length) return null
  return (
    <p class="tags">
      {tags.map((t) => (
        <a href={`${langPrefix(lang)}/tags/${t.slug}`}>#{t.name}</a>
      ))}
    </p>
  )
}

export function Article({ post }: { post: Post }) {
  const note = post.note
  const ui = UI[post.lang]
  return (
    <article class="post" lang={post.lang}>
      <p class="muted">
        {post.kind === 'note' ? ui.fieldNote : ui.essay}, <time datetime={post.published_at}>{formatDate(post.published_at, post.lang)}</time>
      </p>
      <h1>{post.title}</h1>
      {note ? (
        <aside class="answer" aria-label={ui.shortAnswer}>
          <p>
            <strong>{ui.symptom}</strong> <code translate="no">{note.symptom}</code>
          </p>
          <p>
            <strong>{ui.fix}</strong> {note.fix}
          </p>
          <p class="verified" translate="no">
            {ui.verified} {note.verified_at.slice(0, 10)}:{' '}
            {Object.entries(note.environment)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}
          </p>
        </aside>
      ) : null}
      {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
      <div class="prose">{raw(post.body_html)}</div>
      <TagLinks tags={post.tags} lang={post.lang} />
    </article>
  )
}
