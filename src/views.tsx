import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { Achievement, FeaturedProject, HomeProfile, Kind, Lang, Post, PostListItem, Project, ProjectCase, Tag } from './db'
import { firstParagraph } from './db'
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
  // Kinds of post published in this language; an empty section stays out of the menu.
  kinds?: Kind[]
  // The site section this page belongs to, shown after the name as a path.
  section?: 'writing' | 'notes' | 'projects' | 'awards' | 'about'
  // The page itself, when it sits below a section: the last part of the path.
  leaf?: { label: string; href: string }
  children: Child
}

const OG_IMAGE = '/og.png'

export function Layout({ title, description, lang = 'en', canonical, alternates, switchTo, noindex, kinds = [], section, leaf, children }: LayoutProps) {
  const ui = UI[lang]
  const pre = langPrefix(lang)
  const other = otherLang(lang)
  const otherUrl = alternates?.[other]
  // The same page in the other language when it exists, else that language's home.
  const switchHref = switchTo ?? (otherUrl ? new URL(otherUrl).pathname : homePath(other))
  // English readers only get the switch where a real translation waits; Turkish pages can always go back.
  const showSwitch = lang === 'tr' || !!(alternates?.en && alternates.tr)
  const navLink = (name: NonNullable<LayoutProps['section']>, label: string) => (
    <a href={`${pre}/${name}`} aria-current={section === name ? 'page' : undefined}>{label}</a>
  )
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f1" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#171a1f" />
        <title>{title}</title>
        <link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        {description ? <meta name="description" content={description} /> : null}
        {noindex ? <meta name="robots" content="noindex" /> : null}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        {canonical ? (
          <>
            <meta property="og:type" content="website" />
            <meta property="og:title" content={title} />
            {description ? <meta property="og:description" content={description} /> : null}
            <meta property="og:url" content={canonical} />
            <meta property="og:image" content={new URL(OG_IMAGE, canonical).href} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta name="twitter:card" content="summary_large_image" />
          </>
        ) : null}
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
      <body>
        <a class="skip-link" href="#main">{ui.skip}</a>
        <header class="site-header">
          <span class="site-path">
            <a class="wordmark" href={homePath(lang)} aria-label={`~/ismail, ${ui.home}`}>
              <span class="accent">~/</span>ismail
            </a>
            {section ? (
              <a class="wordmark crumb" href={`${pre}/${section}`}>
                /{section}
              </a>
            ) : null}
            {leaf ? (
              <a class="wordmark crumb" href={leaf.href}>
                /{leaf.label}
              </a>
            ) : null}
          </span>
          <nav aria-label={ui.mainNav}>
            {navLink('projects', ui.projects)}
            {kinds.includes('note') || section === 'notes' ? navLink('notes', ui.notes) : null}
            {kinds.includes('writing') || section === 'writing' ? navLink('writing', ui.writing) : null}
            {navLink('awards', ui.awards)}
            {navLink('about', ui.about)}
            {showSwitch ? (
              <a class="lang-switch" href={switchHref} hreflang={other} lang={other} aria-label={`${other.toUpperCase()}, ${UI[other].languageName}`}>
                {other.toUpperCase()}
              </a>
            ) : null}
            <button type="button" class="theme-toggle" data-theme-toggle aria-label={ui.switchTheme}>
              ◐
            </button>
          </nav>
        </header>
        <main id="main" tabindex={-1}>{children}</main>
        <footer class="site-footer">
          <a href={`${pre}/rss.xml`}>RSS</a>
          <a href="https://github.com/ismailtrm" translate="no">@ismailtrm</a>
          <a href="https://www.linkedin.com/in/ismailtarim">LinkedIn</a>
          <a href="mailto:me@ismailtarim.dev">Email</a>
          <span class="copyright">© {new Date().getUTCFullYear()} İsmail Tarım</span>
        </footer>
      </body>
    </html>
  )
}

function Section({ title, more, children }: { title: Child; more?: { label: string; href: string }; children: Child }) {
  return (
    <section class="section">
      <div class="section-head">
        <h2>{title}</h2>
        {more ? <a href={more.href}>{more.label}</a> : null}
      </div>
      {children}
    </section>
  )
}

// One row of every list on the site: what a reader scans for in the left column, the work on the right.
function Entry({ id, meta, children }: { id?: string; meta: Child; children: Child }) {
  return (
    <li class="entry" id={id}>
      <div class="entry-meta">{meta}</div>
      <div class="entry-main">{children}</div>
    </li>
  )
}

function statusText(p: { status: Project['status']; status_label: string | null }, lang: Lang) {
  return p.status_label ?? UI[lang].statusLabel[p.status]
}

function PostEntry({ post, lang }: { post: Pick<PostListItem, 'kind' | 'slug' | 'lang' | 'title' | 'published_at'>; lang: Lang }) {
  return (
    <Entry meta={<time datetime={post.published_at}>{formatDate(post.published_at, lang)}</time>}>
      <p class="entry-title">
        <a href={postPath(post.kind, post.slug, post.lang)} lang={post.lang}>
          {post.title}
        </a>
      </p>
    </Entry>
  )
}

export function PostList({ posts, lang = 'en' }: { posts: PostListItem[]; lang?: Lang }) {
  if (!posts.length) return <p class="muted">{UI[lang].noPosts}</p>
  return (
    <ul class="entries tight">
      {posts.map((p) => (
        <PostEntry post={p} lang={lang} />
      ))}
    </ul>
  )
}

function ProjectEntry({ project, lang }: { project: Project & { post?: FeaturedProject['post'] }; lang: Lang }) {
  const pre = langPrefix(lang)
  // A case page wins, then a published post in its own language; the query already dropped unpublished posts.
  const href = project.has_case ? `${pre}/projects/${project.slug}` : project.post ? postPath(project.post.kind, project.post.slug, project.post.lang) : null
  return (
    <Entry
      meta={
        <>
          <span class="num">{project.year}</span>
          <span class={`status status-${project.status}`}>{statusText(project, lang)}</span>
        </>
      }
    >
      <p class="entry-title">{href ? <a href={href}>{project.name}</a> : project.name}</p>
      <p class="entry-text">{project.summary}</p>
      {project.results.length ? (
        <p class="entry-rel">
          {project.results.map((r) => (
            <a href={`${pre}/awards#a-${r.id}`}>{r.outcome || r.title}</a>
          ))}
        </p>
      ) : null}
      <BadgeList items={project.links} />
    </Entry>
  )
}

export function ProjectList({ projects, lang = 'en' }: { projects: Project[]; lang?: Lang }) {
  if (!projects.length) return <p class="muted">{UI[lang].noProjects}</p>
  return (
    <ul class="entries">
      {projects.map((p) => (
        <ProjectEntry project={p} lang={lang} />
      ))}
    </ul>
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

function AchievementItem({ item, lang }: { item: Achievement; lang: Lang }) {
  const ui = UI[lang]
  return (
    <Entry
      id={`a-${item.id}`}
      meta={
        <>
          <span class="num">{item.year}</span>
          {item.outcome ? <strong>{item.outcome}</strong> : null}
        </>
      }
    >
      <p class="entry-title">{item.title}</p>
      {item.context || item.summary ? <p class="entry-text">{[item.context && `${item.context}.`, item.summary].filter(Boolean).join(' ')}</p> : null}
      {item.project ? (
        <p class="entry-rel">
          {ui.project}: <a href={`${langPrefix(lang)}/projects/${item.project.slug}`}>{item.project.name}</a>
        </p>
      ) : null}
      <BadgeList items={item.links} />
    </Entry>
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
          <Section title={heading}>
            <ul class="entries">
              {mine.map((a) => (
                <AchievementItem item={a} lang={lang} />
              ))}
            </ul>
          </Section>
        ) : null
      })}
    </>
  )
}

// A GitHub profile reads as its handle; every other link keeps the label from the panel.
function profileLinkLabel(link: { label: string; url: string }) {
  const handle = link.url.match(/^https:\/\/github\.com\/([\w-]+)\/?$/)?.[1]
  return handle ? `@${handle}` : link.label
}

function safeProfileLinks(profile: HomeProfile) {
  return profile.links.filter((l) => isSafeHttpUrl(l.url) || /^mailto:[^\s@]+@[^\s@]+$/.test(l.url))
}

type ProfileHomeProps = { profile: HomeProfile; projects: FeaturedProject[]; posts: PostListItem[]; lang: Lang }

export function ProfileHome({ profile, projects, posts, lang }: ProfileHomeProps) {
  const ui = UI[lang]
  const pre = langPrefix(lang)
  const links = safeProfileLinks(profile)
  const intro = firstParagraph(profile.body_html)
  const latest = posts.slice(0, 4)
  return (
    <>
      <div class="home-grid">
        {profile.avatar ? (
          <img class="avatar" src={`/media/${profile.avatar.key}`} alt={profile.name} width={profile.avatar.width} height={profile.avatar.height} fetchpriority="high" />
        ) : null}
        <div class="hero-id">
          <h1>{profile.name}</h1>
          {profile.headline ? <p class="lede">{profile.headline}</p> : null}
        </div>
        <div class="hero-rest">
          {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
          {intro ? <div class="prose" lang={profile.lang}>{raw(intro)}</div> : null}
          <p>
            <a href={`${pre}/about`}>{ui.moreAbout}</a>
          </p>
          <p class="contact">
            {profile.location ? <span class="muted">{profile.location}</span> : null}
            {links.map((l) => (
              <a href={l.url}>{profileLinkLabel(l)}</a>
            ))}
          </p>
          <BadgeList items={profile.badges} />
        </div>
      </div>
      {projects.length ? (
        <Section title={ui.selectedProjects} more={{ label: ui.allProjects, href: `${pre}/projects` }}>
          <ul class="entries">
            {projects.map((p) => (
              <ProjectEntry project={p} lang={lang} />
            ))}
          </ul>
        </Section>
      ) : null}
      {latest.length ? (
        <Section title={latest.every((p) => p.kind === 'note') ? ui.latestNotes : ui.recent} {...(latest.some((p) => p.kind === 'note') ? { more: { label: ui.allNotes, href: `${pre}/notes` } } : {})}>
          <PostList posts={latest} lang={lang} />
        </Section>
      ) : null}
    </>
  )
}

// Facts in the left column, sticky on a wide screen; on a phone they sit between the title and the text.
function FactsPage({ lang, facts, head, children }: { lang: Lang; facts: Child; head: Child; children: Child }) {
  return (
    <article class="case post" lang={lang}>
      <div class="case-head">{head}</div>
      <dl class="facts">{facts}</dl>
      <div class="case-body">{children}</div>
    </article>
  )
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: Child }) {
  return (
    <div class={wide ? 'wide-fact' : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function AboutPage({ profile, lang }: { profile: HomeProfile; lang: Lang }) {
  const ui = UI[lang]
  const links = safeProfileLinks(profile)
  return (
    <FactsPage
      lang={profile.lang}
      head={<h1>{ui.about}</h1>}
      facts={
        <>
          {profile.location ? <Fact label={ui.location} wide>{profile.location}</Fact> : null}
          {links.length ? (
            <Fact label={ui.links} wide>
              <span class="fact-links">
                {links.map((l) => (
                  <a href={l.url}>{profileLinkLabel(l)}</a>
                ))}
              </span>
            </Fact>
          ) : null}
        </>
      }
    >
      {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
      <div class="prose">{raw(profile.body_html)}</div>
    </FactsPage>
  )
}

export function ProjectCasePage({ project, lang }: { project: ProjectCase; lang: Lang }) {
  const ui = UI[lang]
  const pre = langPrefix(lang)
  const awards = project.achievements.filter((a) => a.kind === 'award' && a.outcome)
  return (
    <>
      <FactsPage
        lang="en"
        head={
          <>
            <h1>{project.name}</h1>
            <p class="lede muted">{project.summary}</p>
          </>
        }
        facts={
          <>
            <Fact label={ui.year}><span class="num">{project.year}</span></Fact>
            <Fact label={ui.status}>{statusText(project, lang)}</Fact>
            {project.role ? <Fact label={ui.role} wide>{project.role}</Fact> : null}
            {project.team ? <Fact label={ui.team} wide>{project.team}</Fact> : null}
            {awards.length ? (
              <Fact label={ui.result} wide>
                <span class="fact-links">
                  {awards.map((a) => (
                    <a href={`${pre}/awards#a-${a.id}`}>{a.outcome}</a>
                  ))}
                </span>
              </Fact>
            ) : null}
            {project.links.length ? <Fact label={ui.links} wide><BadgeList items={project.links} /></Fact> : null}
          </>
        }
      >
        {/* case_html is produced by the owner's panel (behind Access), not by visitors. */}
        <div class="prose">{raw(project.case_html)}</div>
      </FactsPage>
      {project.achievements.length || project.post ? (
        <Section title={ui.related}>
          <ul class="entries">
            {project.achievements.map((a) => (
              <Entry
                meta={
                  <>
                    <span class="num">{a.year}</span>
                    {a.outcome ? <span>{a.outcome}</span> : null}
                  </>
                }
              >
                <p class="entry-title">
                  <a href={`${pre}/awards#a-${a.id}`}>{a.title}</a>
                </p>
                <BadgeList items={a.links} />
              </Entry>
            ))}
            {project.post ? <PostEntry post={project.post} lang={lang} /> : null}
          </ul>
        </Section>
      ) : null}
    </>
  )
}

// Symptom and fix are plain text fields, and backticks in them mean code. The Worker renders no Markdown,
// so this handles only that; an unbalanced backtick stays literal.
export function InlineCode({ text }: { text: string }) {
  const parts = text.split('`')
  if (parts.length % 2 === 0) return <>{text}</>
  return <>{parts.map((part, i) => (i % 2 ? <code translate="no">{part}</code> : part))}</>
}

function TagLinks({ tags, lang }: { tags: Tag[]; lang: Lang }) {
  return (
    <span class="fact-links">
      {tags.map((t) => (
        <a href={`${langPrefix(lang)}/tags/${t.slug}`}>#{t.name}</a>
      ))}
    </span>
  )
}

export function Article({ post }: { post: Post }) {
  const note = post.note
  const ui = UI[post.lang]
  return (
    <FactsPage
      lang={post.lang}
      head={<h1>{post.title}</h1>}
      facts={
        <>
          <Fact label={post.kind === 'note' ? ui.fieldNote : ui.essay} wide>
            <time datetime={post.published_at}>{formatDate(post.published_at, post.lang)}</time>
          </Fact>
          {post.tags.length ? <Fact label={ui.tags} wide><TagLinks tags={post.tags} lang={post.lang} /></Fact> : null}
        </>
      }
    >
      {note ? (
        <aside class="answer" aria-label={ui.shortAnswer}>
          <p>
            <strong>{ui.symptom}</strong> <InlineCode text={note.symptom} />
          </p>
          <p>
            <strong>{ui.fix}</strong> <InlineCode text={note.fix} />
          </p>
          <p class="verified" translate="no">
            {ui.verified} {formatDate(note.verified_at, post.lang)}:{' '}
            {Object.entries(note.environment)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}
          </p>
        </aside>
      ) : null}
      {/* body_html is produced by the owner's panel (behind Access), not by visitors. */}
      <div class="prose">{raw(post.body_html)}</div>
    </FactsPage>
  )
}
