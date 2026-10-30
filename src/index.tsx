import { Hono } from 'hono'
import type { Context } from 'hono'
import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { secureHeaders } from 'hono/secure-headers'
import type { Env } from './env'
import { findRedirect, getProjectCase, getPublishedPost, listByTag, listProjects, listPublished } from './db'
import { llmsTxt, rss, sitemap } from './feeds'
import { safeRedirectTarget } from './redirect'
import { Article, Layout, PostList, ProjectLedger } from './views'
import adminApi from './admin/api'

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

app.route('/admin/api', adminApi)

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

app.get('/', async (c) => {
  const [posts, projects] = await Promise.all([listPublished(c.env.DB, null, 10), listProjects(c.env.DB)])
  cache(c)
  return page(
    c,
    <Layout title={c.env.SITE_NAME} canonical={site(c) + '/'} description="Backend and AI systems engineer in İzmir.">
      <section class="intro">
        <p>Backend and AI systems engineer in İzmir. Field notes, projects and essays.</p>
      </section>
      <section>
        <h2>Recent</h2>
        <PostList posts={posts} />
      </section>
      <section>
        <h2>Projects</h2>
        <ProjectLedger projects={projects.slice(0, 5)} />
      </section>
    </Layout>,
  )
})

for (const [path, kind, heading] of [
  ['/writing', 'writing', 'Writing'],
  ['/notes', 'note', 'Notes'],
] as const) {
  app.get(path, async (c) => {
    const posts = await listPublished(c.env.DB, kind, 200)
    cache(c)
    return page(
      c,
      <Layout title={`${heading}, ${c.env.SITE_NAME}`} canonical={site(c) + path}>
        <h1>{heading}</h1>
        <PostList posts={posts} />
      </Layout>,
    )
  })

  app.get(`${path}/:slug{${SLUG}}`, async (c) => {
    const post = await getPublishedPost(c.env.DB, kind, c.req.param('slug'))
    if (!post) return c.notFound()
    cache(c)
    return page(
      c,
      <Layout
        title={`${post.title}, ${c.env.SITE_NAME}`}
        canonical={site(c) + `${path}/${post.slug}`}
        lang={post.lang}
        {...(post.summary ? { description: post.summary } : {})}
      >
        <Article post={post} />
      </Layout>,
    )
  })
}

app.get(`/tags/:tag{${SLUG}}`, async (c) => {
  const found = await listByTag(c.env.DB, c.req.param('tag'))
  if (!found) return c.notFound()
  cache(c)
  return page(
    c,
    <Layout title={`#${found.tag.name}, ${c.env.SITE_NAME}`} canonical={site(c) + `/tags/${found.tag.slug}`}>
      <h1>#{found.tag.name}</h1>
      <PostList posts={found.posts} />
    </Layout>,
  )
})

app.get('/projects', async (c) => {
  const projects = await listProjects(c.env.DB)
  cache(c)
  return page(
    c,
    <Layout title={`Projects, ${c.env.SITE_NAME}`} canonical={site(c) + '/projects'}>
      <h1>Projects</h1>
      <ProjectLedger projects={projects} />
    </Layout>,
  )
})

app.get(`/projects/:slug{${SLUG}}`, async (c) => {
  const slug = c.req.param('slug')
  const project = await getProjectCase(c.env.DB, slug)
  if (!project) return c.notFound()
  cache(c)
  return page(
    c,
    <Layout title={`${project.name}, ${c.env.SITE_NAME}`} canonical={site(c) + `/projects/${slug}`} description={project.summary}>
      <article class="post">
        <h1>{project.name}</h1>
        <p class="muted">{project.summary}</p>
        <div class="prose">{raw(project.case_html)}</div>
      </article>
    </Layout>,
  )
})

app.get('/rss.xml', async (c) => {
  const posts = await listPublished(c.env.DB, null, 50)
  cache(c)
  return c.body(rss(site(c), c.env.SITE_NAME, posts), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' })
})

app.get('/sitemap.xml', async (c) => {
  const [posts, projects] = await Promise.all([listPublished(c.env.DB, null, 5000), listProjects(c.env.DB)])
  cache(c)
  return c.body(sitemap(site(c), posts, projects), 200, { 'Content-Type': 'application/xml; charset=utf-8' })
})

app.get('/llms.txt', async (c) => {
  const posts = await listPublished(c.env.DB, null, 1000)
  cache(c)
  return c.text(llmsTxt(site(c), c.env.SITE_NAME, posts))
})

app.notFound(async (c) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    const from = new URL(c.req.url).pathname
    const to = safeRedirectTarget(from, await findRedirect(c.env.DB, from))
    if (to) return c.redirect(to + new URL(c.req.url).search, 301)
  }
  return page(
    c,
    <Layout title={`Not found, ${c.env.SITE_NAME}`}>
      <h1>Not found</h1>
      <p>
        This page does not exist. Try <a href="/notes">Notes</a> or <a href="/writing">Writing</a>.
      </p>
    </Layout>,
    404,
  )
})

app.onError((err, c) => {
  console.error(err)
  return page(
    c,
    <Layout title={`Error, ${c.env.SITE_NAME}`}>
      <h1>Something broke</h1>
      <p>The page could not be loaded. Try again in a minute.</p>
    </Layout>,
    500,
  )
})

export default app
