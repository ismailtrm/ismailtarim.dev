import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PostInput, ProfileInput, ProjectInput } from '../src/admin/schema'
import { ConflictError, InputError, savePost } from '../src/admin/store'
import { getProfileForEdit, listProfileRevisions, saveProfile } from '../src/admin/profile-store'
import { deleteProject, getProjectForEdit, saveProject } from '../src/admin/project-store'
import { formatDate } from '../src/format'
import { InlineCode } from '../src/views'

const db = (env as unknown as { DB: D1Database }).DB
const worker = (exports as unknown as { default: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }).default
const get = (path: string) => worker.fetch(`https://ismailtarim.dev${path}`, { redirect: 'manual' })
const admin = (path: string, method = 'GET', body?: unknown) =>
  worker.fetch(`http://localhost/admin/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function profile(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    name: 'Ismail Tarim',
    headline: 'Backend engineer',
    location: 'Izmir',
    links: [{ label: 'GitHub', url: 'https://github.com/ismailtrm' }],
    badges: [{ label: 'Linux kernel', url: 'https://git.kernel.org/x' }],
    avatar_key: null,
    body_md: 'hello',
    body_html: '<p>profile body</p>',
    reason: 'save',
    base_revision: null,
    ...overrides,
  }
}

function project(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    slug: 'btmtk',
    name: 'btmtk patch',
    summary: 'ISO init fix',
    year: 2026,
    status: 'merged',
    status_label: null,
    case_md: null,
    case_html: null,
    sort_order: 0,
    visible: true,
    featured: true,
    post_id: null,
    base_updated_at: null,
    links: [{ kind: 'commit', label: '215ef29', url: 'https://git.kernel.org/c/215ef29' }],
    ...overrides,
  }
}

function post(overrides: Partial<PostInput> = {}): PostInput {
  return {
    kind: 'writing',
    slug: 'linked',
    title: 'Linked essay',
    summary: null,
    lang: 'en',
    status: 'published',
    published_at: '2026-10-14T09:00:00Z',
    body_md: 'b',
    body_html: '<p>b</p>',
    tags: [],
    note: null,
    reason: 'publish',
    base_revision: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM profile'),
    db.prepare('DELETE FROM projects'),
    db.prepare('DELETE FROM posts'),
    db.prepare('DELETE FROM redirects'),
    db.prepare('DELETE FROM assets'),
  ])
})

describe('profile admin store', () => {
  it('writes a revision on every save and rejects a stale base revision', async () => {
    const first = await saveProfile(db, 'en', profile())
    const second = await saveProfile(db, 'en', profile({ name: 'Second', base_revision: first.revision }))
    expect(await listProfileRevisions(db, 'en')).toHaveLength(2)
    await expect(saveProfile(db, 'en', profile({ name: 'Stale', base_revision: first.revision }))).rejects.toThrow(ConflictError)
    expect((await getProfileForEdit(db, 'en')).revision).toBe(second.revision)
  })

  it('refuses a first save when a profile already exists', async () => {
    await saveProfile(db, 'en', profile())
    await expect(saveProfile(db, 'en', profile())).rejects.toThrow(ConflictError)
  })

  it('keeps the languages apart', async () => {
    await saveProfile(db, 'en', profile())
    expect((await getProfileForEdit(db, 'tr')).revision).toBeNull()
  })
})

describe('admin API', () => {
  it('rejects unauthenticated profile and project requests', async () => {
    for (const path of ['/profile/en', '/projects', '/projects/1']) {
      const res = await worker.fetch(`https://ismailtarim.dev/admin/api${path}`)
      expect(res.status).toBe(401)
    }
    const put = await worker.fetch('https://ismailtarim.dev/admin/api/profile/en', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(put.status).toBe(401)
  })

  it('validates the profile and projects before writing', async () => {
    expect((await admin('/profile/en', 'PUT', { ...profile(), links: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400)
    expect((await admin('/profile/xx', 'PUT', profile())).status).toBe(404)
    expect((await admin('/projects', 'POST', project({ links: [{ kind: 'repo', label: 'x', url: 'ftp://x' }] }))).status).toBe(400)
    expect((await admin('/projects', 'POST', project({ case_md: 'text', case_html: null }))).status).toBe(400)
  })

  it('rejects featured with visible off with a clear message', async () => {
    const res = await admin('/projects', 'POST', project({ visible: false, featured: true }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('featured')
  })

  it('creates, updates and deletes a project over HTTP', async () => {
    const created = await admin('/projects', 'POST', project())
    expect(created.status).toBe(201)
    const { id, updated_at } = (await created.json()) as { id: number; updated_at: string }
    const updated = await admin(`/projects/${id}`, 'PUT', project({ name: 'renamed', links: [], base_updated_at: updated_at }))
    expect(updated.status).toBe(200)
    const got = (await (await admin(`/projects/${id}`)).json()) as { name: string; links: unknown[] }
    expect(got.name).toBe('renamed')
    expect(got.links).toEqual([])
    expect((await admin(`/projects/${id}`, 'DELETE')).status).toBe(200)
    expect((await admin(`/projects/${id}`)).status).toBe(404)
  })

  it('lists hidden projects too and reports a taken slug as a conflict', async () => {
    await saveProject(db, null, project({ slug: 'hidden', visible: false, featured: false }))
    const list = (await (await admin('/projects')).json()) as { slug: string }[]
    expect(list.map((p) => p.slug)).toContain('hidden')
    expect((await admin('/projects', 'POST', project({ slug: 'hidden' }))).status).toBe(409)
  })

  it('rejects a link to a post that does not exist', async () => {
    expect((await admin('/projects', 'POST', project({ post_id: 9999 }))).status).toBe(400)
  })
})

describe('project cascades', () => {
  it('leaves post_id NULL on the project when the linked post is deleted', async () => {
    const { id: postId } = await savePost(db, null, post())
    const { id } = await saveProject(db, null, project({ post_id: postId }))
    await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run()
    const row = await db.prepare('SELECT post_id FROM projects WHERE id = ?').bind(id).first<{ post_id: number | null }>()
    expect(row).toEqual({ post_id: null })
    expect((await getProjectForEdit(db, id))?.links).toHaveLength(1)
  })

  it('removes the links of a deleted project and nothing else', async () => {
    const a = await saveProject(db, null, project({ slug: 'a' }))
    const b = await saveProject(db, null, project({ slug: 'b' }))
    await deleteProject(db, a.id)
    const left = await db.prepare('SELECT project_id FROM project_links').all<{ project_id: number }>()
    expect(left.results.map((r) => r.project_id)).toEqual([b.id])
  })

  it('does not touch posts when a project is deleted', async () => {
    const { id: postId } = await savePost(db, null, post())
    const p = await saveProject(db, null, project({ post_id: postId }))
    await deleteProject(db, p.id)
    expect((await db.prepare('SELECT COUNT(*) AS n FROM posts').first<{ n: number }>())?.n).toBe(1)
  })
})

describe('public home', () => {
  it('renders the old home while there is no profile', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('class="intro"')
    expect(html).not.toContain('home-grid')
  })

  it('keeps the old home when the profile body is empty', async () => {
    await saveProfile(db, 'en', profile({ body_html: '  ' }))
    const html = await (await get('/')).text()
    expect(html).toContain('class="intro"')
    expect(html).not.toContain('home-grid')
  })

  it('renders aside and body from the profile, without the old intro', async () => {
    await saveProfile(db, 'en', profile())
    await savePost(db, null, post())
    const html = await (await get('/')).text()
    expect(html).toContain('home-grid')
    expect(html).toContain('<h1>Ismail Tarim</h1>')
    expect(html).toContain('Backend engineer')
    expect(html).toContain('Izmir')
    expect(html).toContain('href="https://github.com/ismailtrm"')
    expect(html).toContain('class="badge"')
    expect(html).toContain('<p>profile body</p>')
    expect(html).toContain('Linked essay')
    expect(html).not.toContain('class="intro"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<link rel="alternate" hreflang')
  })

  it('shows the avatar with size attributes and the name as alt', async () => {
    await db.prepare("INSERT INTO assets (r2_key, alt, width, height, content_type) VALUES ('img/2026/a.png', 'me', 400, 400, 'image/png')").run()
    await saveProfile(db, 'en', profile({ avatar_key: 'img/2026/a.png' }))
    const html = await (await get('/')).text()
    expect(html).toContain('src="/media/img/2026/a.png"')
    expect(html).toContain('alt="Ismail Tarim"')
    expect(html).toContain('width="400"')
    expect(html).toContain('height="400"')
  })

  it('accepts a mailto profile link but not a mailto badge', async () => {
    const mail = [{ label: 'Email', url: 'mailto:me@example.com' }]
    expect((await admin('/profile/en', 'PUT', { ...profile(), badges: mail })).status).toBe(400)
    expect((await admin('/profile/en', 'PUT', { ...profile(), links: mail })).status).toBe(200)
    expect(await (await get('/')).text()).toContain('href="mailto:me@example.com"')
  })

  it('shows the section after the name on section pages only', async () => {
    expect(await (await get('/writing')).text()).toContain('class="wordmark crumb" href="/writing"')
    expect(await (await get('/tr/notes')).text()).toContain('class="wordmark crumb" href="/tr/notes"')
    expect(await (await get('/projects')).text()).toContain('class="wordmark crumb" href="/projects"')
    expect(await (await get('/')).text()).not.toContain('wordmark crumb')
  })

  it('shows the status text instead of the fixed label', async () => {
    await admin('/projects', 'POST', project({ slug: 'labelled', status: 'personal', status_label: 'in refactoring', visible: true, featured: true }))
    await admin('/profile/en', 'PUT', profile())
    expect(await (await get('/')).text()).toContain('in refactoring')
    const list = await (await get('/projects')).text()
    expect(list).toContain('in refactoring')
    expect(list).not.toContain('personal tool')
  })

  it('filters unsafe link and badge urls', async () => {
    await db
      .prepare("INSERT INTO profile (lang, name, body_html, links, badges) VALUES ('en', 'N', '<p>x</p>', ?, ?)")
      .bind('[{"label":"bad","url":"javascript:alert(1)"}]', '[{"label":"worse","url":"data:text/html,x"}]')
      .run()
    const html = await (await get('/')).text()
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text')
  })

  it('falls back to the English profile on /tr as noindex without hreflang on either home', async () => {
    await saveProfile(db, 'en', profile())
    const tr = await (await get('/tr')).text()
    expect(tr).toContain('<html lang="tr">')
    expect(tr).toContain('<p>profile body</p>')
    expect(tr).toContain('<meta name="robots" content="noindex"/>')
    expect(tr).not.toContain('<link rel="alternate" hreflang')
    const en = await (await get('/')).text()
    expect(en).not.toContain('<meta name="robots"')
    expect(en).not.toContain('<link rel="alternate" hreflang')
  })

  it('uses the Turkish profile with hreflang when both exist', async () => {
    await saveProfile(db, 'en', profile())
    await saveProfile(db, 'tr', profile({ name: 'Ismail TR', body_html: '<p>turkce govde</p>' }))
    const tr = await (await get('/tr')).text()
    expect(tr).toContain('turkce govde')
    expect(tr).not.toContain('noindex')
    expect(tr).toContain('<link rel="alternate" hreflang="en"')
  })

  it('never renders a profile with an empty body on /tr', async () => {
    await saveProfile(db, 'tr', profile({ body_html: '' }))
    const html = await (await get('/tr')).text()
    expect(html).not.toContain('home-grid')
    expect(html).toContain('class="intro"')
  })

  it('shows featured visible projects only', async () => {
    await saveProfile(db, 'en', profile())
    await saveProject(db, null, project({ slug: 'shown', name: 'Shown one' }))
    await saveProject(db, null, project({ slug: 'plain', name: 'Not featured', featured: false }))
    await saveProject(db, null, project({ slug: 'hid', name: 'Hidden one', visible: false, featured: false }))
    await db.prepare("UPDATE projects SET featured = 1 WHERE slug = 'hid'").run()
    const html = await (await get('/')).text()
    expect(html).toContain('Selected projects')
    expect(html).toContain('Shown one')
    expect(html).toContain('215ef29')
    expect(html).not.toContain('Not featured')
    expect(html).not.toContain('Hidden one')
  })

  it('omits the selected projects section when none are featured', async () => {
    await saveProfile(db, 'en', profile())
    expect(await (await get('/')).text()).not.toContain('Selected projects')
  })

  it('links a featured project to its case page first, then a published post, else plain text', async () => {
    await saveProfile(db, 'en', profile())
    const { id: postId } = await savePost(db, null, post({ kind: 'note', slug: 'the-note', note: { symptom: 's', fix: 'f', environment: {}, verified_at: '2026-10-01' } }))
    await saveProject(db, null, project({ slug: 'with-case', name: 'Case one', case_md: 'x', case_html: '<p>x</p>', post_id: postId, sort_order: 1 }))
    await saveProject(db, null, project({ slug: 'with-post', name: 'Post one', post_id: postId, sort_order: 2 }))
    await saveProject(db, null, project({ slug: 'bare', name: 'Bare one', sort_order: 3 }))
    const html = await (await get('/')).text()
    expect(html).toContain('<a href="/projects/with-case">Case one</a>')
    expect(html).toContain('<a href="/notes/the-note">Post one</a>')
    expect(html).toContain('Bare one')
    expect(html).not.toContain('>Bare one</a>')
  })

  it('does not link or leak an unpublished post', async () => {
    await saveProfile(db, 'en', profile())
    const { id: postId } = await savePost(db, null, post({ slug: 'secret-draft', title: 'Secret title', status: 'draft', published_at: null, reason: 'save' }))
    await saveProject(db, null, project({ name: 'Linked to draft', post_id: postId }))
    const html = await (await get('/')).text()
    expect(html).toContain('Linked to draft')
    expect(html).not.toContain('secret-draft')
    expect(html).not.toContain('Secret title')
  })
})

describe('redirects from /about', () => {
  it('301s /about to / and /tr/about to /tr', async () => {
    const en = await get('/about')
    expect(en.status).toBe(301)
    expect(en.headers.get('Location')).toBe('/')
    const tr = await get('/tr/about')
    expect(tr.status).toBe(301)
    expect(tr.headers.get('Location')).toBe('/tr')
  })
})

const CASE = { case_md: 'text', case_html: '<p>text</p>' }
const redirects = async () =>
  (await db.prepare('SELECT from_path, to_path FROM redirects ORDER BY from_path').all<{ from_path: string; to_path: string }>()).results

describe('home indexing state in the sitemap and head', () => {
  const sitemap = async () => (await get('/sitemap.xml')).text()
  const homeLinks = (xml: string) => xml.match(/<url><loc>https:\/\/ismailtarim\.dev\/(tr)?<\/loc>.*?<\/url>/g) ?? []

  it('lists both homes with alternates when neither language has a profile', async () => {
    const homes = homeLinks(await sitemap())
    expect(homes).toHaveLength(2)
    expect(homes.every((h) => h.includes('hreflang'))).toBe(true)
  })

  it('lists both homes with alternates when both have a profile', async () => {
    await saveProfile(db, 'en', profile())
    await saveProfile(db, 'tr', profile({ name: 'TR', body_html: '<p>tr</p>' }))
    const homes = homeLinks(await sitemap())
    expect(homes).toHaveLength(2)
    expect(homes.every((h) => h.includes('hreflang'))).toBe(true)
  })

  it('leaves /tr out of the sitemap when it only borrows the English profile', async () => {
    await saveProfile(db, 'en', profile())
    const homes = homeLinks(await sitemap())
    expect(homes).toHaveLength(1)
    expect(homes[0]).not.toContain('hreflang')
  })

  it('lists both homes without alternates when only Turkish has a profile, and the legacy English home declares none', async () => {
    await saveProfile(db, 'tr', profile({ name: 'TR', body_html: '<p>tr</p>' }))
    const homes = homeLinks(await sitemap())
    expect(homes).toHaveLength(2)
    expect(homes.some((h) => h.includes('hreflang'))).toBe(false)
    const en = await (await get('/')).text()
    expect(en).toContain('class="intro"')
    expect(en).not.toContain('<link rel="alternate" hreflang')
    const tr = await (await get('/tr')).text()
    expect(tr).not.toContain('noindex')
    expect(tr).not.toContain('<link rel="alternate" hreflang')
  })
})

describe('project slug changes', () => {
  it('redirects the old case page in both languages and follows chains and renames back', async () => {
    const first = await saveProject(db, null, project({ slug: 'old', ...CASE }))
    const second = await saveProject(db, first.id, project({ slug: 'new', ...CASE, base_updated_at: first.updated_at }))
    expect(await redirects()).toEqual([
      { from_path: '/projects/old', to_path: '/projects/new' },
      { from_path: '/tr/projects/old', to_path: '/tr/projects/new' },
    ])
    const third = await saveProject(db, first.id, project({ slug: 'newer', ...CASE, base_updated_at: second.updated_at }))
    expect((await redirects()).map((r) => `${r.from_path}>${r.to_path}`)).toEqual([
      '/projects/new>/projects/newer',
      '/projects/old>/projects/newer',
      '/tr/projects/new>/tr/projects/newer',
      '/tr/projects/old>/tr/projects/newer',
    ])
    await saveProject(db, first.id, project({ slug: 'old', ...CASE, base_updated_at: third.updated_at }))
    const left = (await redirects()).map((r) => `${r.from_path}>${r.to_path}`)
    expect(left).not.toContain('/projects/old>/projects/old')
    expect(left.some((r) => r.startsWith('/projects/old>'))).toBe(false)
    expect(left).toContain('/projects/newer>/projects/old')
    const res = await get('/projects/newer')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/projects/old')
  })

  it('writes no redirect when the old project had no case page', async () => {
    const first = await saveProject(db, null, project({ slug: 'plain' }))
    await saveProject(db, first.id, project({ slug: 'plain-2', base_updated_at: first.updated_at }))
    expect(await redirects()).toEqual([])
  })
})

describe('project optimistic lock', () => {
  it('rejects a stale save with a conflict', async () => {
    const first = await saveProject(db, null, project())
    await saveProject(db, first.id, project({ name: 'tab one', base_updated_at: first.updated_at }))
    await expect(saveProject(db, first.id, project({ name: 'tab two', base_updated_at: first.updated_at }))).rejects.toThrow(ConflictError)
  })

  it('lets only one of two concurrent saves through', async () => {
    const first = await saveProject(db, null, project())
    const outcomes = await Promise.allSettled([
      saveProject(db, first.id, project({ name: 'a', base_updated_at: first.updated_at })),
      saveProject(db, first.id, project({ name: 'b', base_updated_at: first.updated_at })),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
  })

  it('answers 409, not a bad-post 400, when the project was deleted meanwhile', async () => {
    const first = await saveProject(db, null, project())
    await deleteProject(db, first.id)
    const res = await admin(`/projects/${first.id}`, 'PUT', project({ base_updated_at: first.updated_at }))
    expect(res.status).toBe(409)
    const direct = await saveProject(db, null, project({ slug: 'again' }))
    await deleteProject(db, direct.id)
    await expect(saveProject(db, direct.id, project({ base_updated_at: null }))).rejects.toThrow(ConflictError)
  })

  it('still reports a real bad post_id as 400', async () => {
    const first = await saveProject(db, null, project())
    expect((await admin(`/projects/${first.id}`, 'PUT', project({ post_id: 9999, base_updated_at: first.updated_at }))).status).toBe(400)
  })
})

describe('avatar and case study validation', () => {
  it('refuses an avatar key that is not an uploaded image', async () => {
    await expect(saveProfile(db, 'en', profile({ avatar_key: 'img/2026/missing.png' }))).rejects.toThrow(InputError)
    await db.prepare("INSERT INTO assets (r2_key, alt, content_type) VALUES ('img/2026/doc.bin', 'x', 'application/pdf')").run()
    await expect(saveProfile(db, 'en', profile({ avatar_key: 'img/2026/doc.bin' }))).rejects.toThrow(InputError)
    expect((await admin('/profile/en', 'PUT', profile({ avatar_key: 'img/2026/missing.png' }))).status).toBe(400)
  })

  it('refuses dot-dot keys', async () => {
    expect((await admin('/profile/en', 'PUT', profile({ avatar_key: 'img/../secret.png' }))).status).toBe(400)
  })

  it('requires case_md and case_html to be both empty or both filled', async () => {
    expect((await admin('/projects', 'POST', project({ case_md: '  ', case_html: '<p>x</p>' }))).status).toBe(400)
    expect((await admin('/projects', 'POST', project({ case_md: 'x', case_html: ' ' }))).status).toBe(400)
    expect((await admin('/projects', 'POST', project({ case_md: '', case_html: null }))).status).toBe(201)
  })

  it('does not treat a whitespace-only case_html as a case page', async () => {
    await saveProfile(db, 'en', profile())
    await saveProject(db, null, project({ slug: 'blank-case', name: 'Blank case' }))
    await db.prepare("UPDATE projects SET case_html = '  ' WHERE slug = 'blank-case'").run()
    const html = await (await get('/')).text()
    expect(html).toContain('Blank case')
    expect(html).not.toContain('href="/projects/blank-case"')
    expect((await get('/projects/blank-case')).status).toBe(404)
  })
})

describe('page chrome', () => {
  it.each([
    ['/', 'Skip to content'],
    ['/tr/', 'İçeriğe geç'],
  ])('%s links past the header to main and sets a theme color', async (path, label) => {
    const html = await (await get(path)).text()
    expect(html).toContain(`<a class="skip-link" href="#main">${label}</a>`)
    expect(html).toContain('<main id="main"')
    expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#171a1f"')
  })

  it('marks the current section and shares a card', async () => {
    const html = await (await get('/projects')).text()
    expect(html).toContain('<a href="/projects" aria-current="page">')
    expect(html).toContain('<meta property="og:image" content="https://ismailtarim.dev/og.png"')
    expect(html).toContain('<meta name="description"')
  })

  it('offers no language switch from English pages that have no translation', async () => {
    expect(await (await get('/projects')).text()).not.toContain('class="lang-switch"')
    expect(await (await get('/tr/projects')).text()).toContain('class="lang-switch"')
  })

  it('keeps empty lists out of the index', async () => {
    const html = await (await get('/tr/writing')).text()
    expect(html).toContain('<meta name="robots" content="noindex"')
    expect(html).not.toContain('rel="alternate" hreflang=')
  })
})

describe('note answer box', () => {
  it('renders backticks as code and escapes the rest', () => {
    const html = String(InlineCode({ text: 'run `ls <x>` now' }))
    expect(html).toContain('<code translate="no">ls &lt;x&gt;</code>')
    expect(html).not.toContain('`')
  })

  it('leaves an unbalanced backtick alone', () => {
    expect(String(InlineCode({ text: 'a ` b' }))).toContain('a ` b')
  })
})

describe('dates', () => {
  it('writes September with three letters like every other month', () => {
    expect(formatDate('2026-09-18T00:00:00Z')).toBe('18 Sep 2026')
  })
})
