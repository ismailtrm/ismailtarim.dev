import { Hono } from 'hono'
import type { Context } from 'hono'
import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { secureHeaders } from 'hono/secure-headers'
import type { Env } from './env'
import { findRedirect, getProjectCase, getPublishedPost, listByTag, listAchievements, listFeaturedProjects, listHomeProfiles, listProjects, listPublished, listTranslations } from './db'
import type { Lang } from './db'
import { homeState } from './home-state'
import { llmsTxt, rss, sitemap } from './feeds'
import { homePath, langPrefix, otherLang, UI } from './i18n'
import { safeRedirectTarget } from './redirect'
import { AchievementList, Article, Layout, PostList, ProfileHome, ProjectLedger } from './views'
import adminApi from './admin/api'
import { recordRead, rollupRecent } from './stats'

type C = Context<{ Bindings: Env }>

const app = new Hono<{ Bindings: Env }>({ strict: false })

const SLUG = '[a-z0-9-]+'

// body_html is owner-written and rendered raw, so the CSP is the backstop: no inline or third-party script.
app.use(
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // Cloudflare Web Analytics: the beacon script and the endpoint it reports to.
      scriptSrc: ["'self'", 'https://static.cloudflareinsights.com'],
      connectSrc: ["'self'", 'https://cloudflareinsights.com'],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
)

app.use(async (c, next) => {
  await next()
  // Counting must never cost a reader the page.
  try {
    recordRead(c.env, c.req.raw, c.req.path, c.res.status)
  } catch (e) {
    console.error('recordRead', e)
  }
})

app.route('/admin/api', adminApi)

// Crawlers are welcome, AI ones included: the notes exist to be found. /admin is behind Access anyway.
app.get('/robots.txt', (c) => {
  cache(c)
  return c.text(
    `User-Agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: /\nDisallow: /admin\n\nSitemap: ${site(c)}/sitemap.xml\n`,
  )
})

// Uploaded images. Keys carry a random UUID, so a key never changes content and can be cached for a year.
// SVG uploads are refused (src/admin/api.ts): served from this origin they could run script.
app.get('/media/:key{img/.+}', async (c) => {
  const obj = await c.env.MEDIA.get(c.req.param('key'))
  if (!obj) return c.notFound()
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

function site(c: C): string {
  return c.env.SITE_URL.replace(/\/+$/, '')
}

// Pages are rendered from D1 per request; staleness after a publish is bounded by PAGE_CACHE_SECONDS (browser cache).
function cache(c: C) {
  const n = Number(c.env.PAGE_CACHE_SECONDS)
  c.header('Cache-Control', `public, max-age=${Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60}`)
}

function page(c: C, node: HtmlEscapedString | Promise<HtmlEscapedString>, status: 200 | 404 | 500 = 200) {
  return c.html(html`<!DOCTYPE html>${node}`, status)
}

// Every public page exists under both prefixes; a post keeps the same slug in each language.
const LANGS = [
  ['', 'en'],
  ['/tr', 'tr'],
] as const

// Absolute URLs of one page in both languages, for hreflang and the language switch.
function bothLangs(c: C, path: (lang: Lang) => string): Partial<Record<Lang, string>> {
  return { en: site(c) + path('en'), tr: site(c) + path('tr') }
}

function pageLang(c: C): Lang {
  return /^\/tr(\/|$)/.test(c.req.path) ? 'tr' : 'en'
}

for (const [pre, lang] of LANGS) {
  const ui = UI[lang]

  app.get(pre || '/', async (c) => {
    const [profiles, posts] = await Promise.all([listHomeProfiles(c.env.DB), listPublished(c.env.DB, lang, null, 10)])
    // The Turkish home borrows the English profile when it has none of its own.
    const profile = profiles[lang] ?? (lang === 'tr' ? profiles.en : undefined)
    const state = homeState(profiles)
    cache(c)
    if (profile) {
      const projects = await listFeaturedProjects(c.env.DB)
      return page(
        c,
        <Layout
          title={c.env.SITE_NAME}
          canonical={site(c) + homePath(lang)}
          alternates={state.paired ? bothLangs(c, homePath) : {}}
          noindex={lang === 'tr' && !state.trIndexable}
          wide
          lang={lang}
          description={profile.headline || ui.tagline}
        >
          <ProfileHome profile={profile} projects={projects} posts={posts} lang={lang} />
        </Layout>,
      )
    }
    const ledger = await listProjects(c.env.DB)
    return page(
      c,
      <Layout
        title={c.env.SITE_NAME}
        canonical={site(c) + homePath(lang)}
        alternates={state.paired ? bothLangs(c, homePath) : {}}
        lang={lang}
        description={ui.tagline}
      >
        <section class="intro">
          <p>{ui.intro}</p>
        </section>
        <section>
          <h2>{ui.recent}</h2>
          <PostList posts={posts} lang={lang} />
        </section>
        <section>
          <h2>{ui.projects}</h2>
          <ProjectLedger projects={ledger.slice(0, 5)} lang={lang} />
        </section>
      </Layout>,
    )
  })

  app.get(`${pre}/about`, (c) => c.redirect(homePath(lang), 301))

  for (const [section, kind, heading] of [
    ['/writing', 'writing', ui.writing],
    ['/notes', 'note', ui.notes],
  ] as const) {
    const path = pre + section
    const sectionName = section === '/writing' ? 'writing' : 'notes'

    app.get(path, async (c) => {
      const posts = await listPublished(c.env.DB, lang, kind, 200)
      cache(c)
      return page(
        c,
        <Layout title={`${heading}, ${c.env.SITE_NAME}`} canonical={site(c) + path} alternates={bothLangs(c, (l) => langPrefix(l) + section)} lang={lang} section={sectionName}>
          <h1>{heading}</h1>
          <PostList posts={posts} lang={lang} />
        </Layout>,
      )
    })

    app.get(`${path}/:slug{${SLUG}}`, async (c) => {
      const post = await getPublishedPost(c.env.DB, lang, kind, c.req.param('slug'))
      if (!post) return c.notFound()
      const translations = await listTranslations(c.env.DB, kind, post.slug)
      cache(c)
      return page(
        c,
        <Layout
          title={`${post.title}, ${c.env.SITE_NAME}`}
          canonical={site(c) + `${path}/${post.slug}`}
          alternates={translations.length > 1 ? bothLangs(c, (l) => `${langPrefix(l)}${section}/${post.slug}`) : {}}
          lang={post.lang}
          section={sectionName}
          {...(post.summary ? { description: post.summary } : {})}
        >
          <Article post={post} />
        </Layout>,
      )
    })
  }

  app.get(`${pre}/tags/:tag{${SLUG}}`, async (c) => {
    const [found, inOther] = await Promise.all([
      listByTag(c.env.DB, lang, c.req.param('tag')),
      listByTag(c.env.DB, otherLang(lang), c.req.param('tag')),
    ])
    if (!found) return c.notFound()
    cache(c)
    return page(
      c,
      <Layout
        title={`#${found.tag.name}, ${c.env.SITE_NAME}`}
        canonical={site(c) + `${pre}/tags/${found.tag.slug}`}
        alternates={inOther ? bothLangs(c, (l) => `${langPrefix(l)}/tags/${found.tag.slug}`) : {}}
        lang={lang}
      >
        <h1>#{found.tag.name}</h1>
        <PostList posts={found.posts} lang={lang} />
      </Layout>,
    )
  })

  // Projects are single-language for now: the Turkish pages show the English project data in Turkish chrome,
  // so they declare no hreflang and are noindex until projects get translations.
  app.get(`${pre}/projects`, async (c) => {
    const projects = await listProjects(c.env.DB)
    cache(c)
    return page(
      c,
      <Layout
        title={`${ui.projects}, ${c.env.SITE_NAME}`}
        canonical={site(c) + `${pre}/projects`}
        switchTo={`${langPrefix(otherLang(lang))}/projects`}
        noindex={lang === 'tr'}
        lang={lang}
        section="projects"
      >
        <h1>{ui.projects}</h1>
        <ProjectLedger projects={projects} lang={lang} />
      </Layout>,
    )
  })

  // Awards are single-language like projects: /tr shows the English data in Turkish chrome, noindex, no hreflang.
  app.get(`${pre}/awards`, async (c) => {
    const items = await listAchievements(c.env.DB)
    cache(c)
    return page(
      c,
      <Layout
        title={`${ui.awards}, ${c.env.SITE_NAME}`}
        canonical={site(c) + `${pre}/awards`}
        switchTo={`${langPrefix(otherLang(lang))}/awards`}
        noindex={lang === 'tr'}
        lang={lang}
        section="awards"
      >
        <h1>{ui.awardsHeading}</h1>
        <AchievementList items={items} lang={lang} />
      </Layout>,
    )
  })

  app.get(`${pre}/projects/:slug{${SLUG}}`, async (c) => {
    const slug = c.req.param('slug')
    const project = await getProjectCase(c.env.DB, slug)
    if (!project) return c.notFound()
    cache(c)
    return page(
      c,
      <Layout
        title={`${project.name}, ${c.env.SITE_NAME}`}
        canonical={site(c) + `${pre}/projects/${slug}`}
        switchTo={`${langPrefix(otherLang(lang))}/projects/${slug}`}
        noindex={lang === 'tr'}
        lang={lang}
        section="projects"
        description={project.summary}
      >
        <article class="post">
          <h1>{project.name}</h1>
          <p class="muted">{project.summary}</p>
          <div class="prose">{raw(project.case_html)}</div>
        </article>
      </Layout>,
    )
  })

  app.get(`${pre}/rss.xml`, async (c) => {
    const posts = await listPublished(c.env.DB, lang, null, 50)
    cache(c)
    return c.body(rss(site(c), c.env.SITE_NAME, posts, lang), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' })
  })
}

app.get('/sitemap.xml', async (c) => {
  const [en, tr, projects, profiles, achievements] = await Promise.all([
    listPublished(c.env.DB, 'en', null, 5000),
    listPublished(c.env.DB, 'tr', null, 5000),
    listProjects(c.env.DB),
    listHomeProfiles(c.env.DB),
    listAchievements(c.env.DB),
  ])
  cache(c)
  return c.body(sitemap(site(c), [...en, ...tr], projects, homeState(profiles), achievements.length > 0), 200, { 'Content-Type': 'application/xml; charset=utf-8' })
})

app.get('/llms.txt', async (c) => {
  const [en, tr] = await Promise.all([listPublished(c.env.DB, 'en', null, 1000), listPublished(c.env.DB, 'tr', null, 1000)])
  cache(c)
  return c.text(llmsTxt(site(c), c.env.SITE_NAME, [...en, ...tr]))
})

app.notFound(async (c) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    const from = new URL(c.req.url).pathname
    const to = safeRedirectTarget(from, await findRedirect(c.env.DB, from))
    if (to) return c.redirect(to + new URL(c.req.url).search, 301)
  }
  const lang = pageLang(c)
  const ui = UI[lang]
  const pre = langPrefix(lang)
  return page(
    c,
    <Layout title={`${ui.notFoundTitle}, ${c.env.SITE_NAME}`} lang={lang}>
      <h1>{ui.notFoundTitle}</h1>
      <p>
        {ui.notFoundBefore}
        <a href={`${pre}/notes`}>{ui.notes}</a>
        {ui.notFoundOr}
        <a href={`${pre}/writing`}>{ui.writing}</a>
        {ui.notFoundAfter}
      </p>
    </Layout>,
    404,
  )
})

app.onError((err, c) => {
  console.error(err)
  const lang = pageLang(c)
  const ui = UI[lang]
  return page(
    c,
    <Layout title={`${ui.errorTitle}, ${c.env.SITE_NAME}`} lang={lang}>
      <h1>{ui.errorHeading}</h1>
      <p>{ui.errorBody}</p>
    </Layout>,
    500,
  )
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env) {
    await rollupRecent(env)
  },
} satisfies ExportedHandler<Env>
