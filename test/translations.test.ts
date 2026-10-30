import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { PostInput } from '../src/admin/schema'
import { ConflictError, savePost } from '../src/admin/store'

const db = (env as unknown as { DB: D1Database }).DB
const worker = (exports as unknown as { default: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }).default
const get = (path: string) => worker.fetch(`https://ismailtarim.dev${path}`, { redirect: 'manual' })

function post(overrides: Partial<PostInput> = {}): PostInput {
  return {
    kind: 'note',
    slug: 'ssh-dscp-ef',
    title: 'SSH hangs on DSCP EF',
    summary: null,
    lang: 'en',
    status: 'published',
    published_at: '2026-10-14T09:00:00Z',
    body_md: 'body',
    body_html: '<p>english body</p>',
    tags: ['Linux'],
    note: { symptom: 'connect timeout', fix: 'IPQoS none', environment: { distro: 'Arch' }, verified_at: '2026-10-14' },
    reason: 'publish',
    base_revision: null,
    ...overrides,
  }
}

async function slugOf(id: number) {
  return (await db.prepare('SELECT slug FROM posts WHERE id = ?').bind(id).first<{ slug: string }>())?.slug
}

function send(body: PostInput) {
  return worker.fetch('http://localhost/admin/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify(body),
  })
}

describe('translations', () => {
  it('saves an English and a Turkish post under the same kind and slug', async () => {
    expect((await send(post({ slug: 'pair' }))).status).toBe(201)
    expect((await send(post({ slug: 'pair', lang: 'tr', title: 'SSH DSCP EF', body_html: '<p>turkce</p>' }))).status).toBe(201)
  })

  it('refuses a second post with the same kind, language and slug', async () => {
    expect((await send(post({ slug: 'dup' }))).status).toBe(201)
    const res = await send(post({ slug: 'dup' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'another post of this kind and language already uses this slug' })
  })

  it('serves each language at its own URL with lang, canonical and hreflang alternates', async () => {
    await savePost(db, null, post({ slug: 'both' }))
    await savePost(db, null, post({ slug: 'both', lang: 'tr', title: 'Turkce baslik', body_html: '<p>turkce govde</p>' }))

    const en = await (await get('/notes/both')).text()
    expect(en).toContain('<html lang="en">')
    expect(en).toContain('english body')
    expect(en).toContain('<link rel="canonical" href="https://ismailtarim.dev/notes/both"/>')
    expect(en).toContain('hreflang="tr" href="https://ismailtarim.dev/tr/notes/both"')
    expect(en).toContain('hreflang="x-default" href="https://ismailtarim.dev/notes/both"')
    expect(en).toContain('href="/tr/notes/both"')

    const tr = await (await get('/tr/notes/both')).text()
    expect(tr).toContain('<html lang="tr">')
    expect(tr).toContain('turkce govde')
    expect(tr).toContain('<link rel="canonical" href="https://ismailtarim.dev/tr/notes/both"/>')
    expect(tr).toContain('hreflang="en" href="https://ismailtarim.dev/notes/both"')
    expect(tr).toContain('hreflang="x-default" href="https://ismailtarim.dev/notes/both"')
    expect(tr).toContain('Notlar')
    expect(tr).toContain('class="lang-switch" href="/notes/both"')
  })

  it('gives a Turkish-only post no alternates and a switch to the English home', async () => {
    await savePost(db, null, post({ slug: 'only-tr', lang: 'tr', title: 'Sadece Turkce' }))
    const tr = await (await get('/tr/notes/only-tr')).text()
    expect(tr).not.toContain('rel="alternate" hreflang=')
    expect(tr).not.toContain('x-default')
    expect(tr).toContain('class="lang-switch" href="/"')
    expect((await get('/notes/only-tr')).status).toBe(404)
  })

  it('serves the Turkish home with and without a trailing slash, with alternates', async () => {
    for (const path of ['/tr', '/tr/']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('<html lang="tr">')
      expect(body).toContain('Son yazılar')
      expect(body).toContain('<link rel="canonical" href="https://ismailtarim.dev/tr"/>')
      expect(body).toContain('hreflang="en" href="https://ismailtarim.dev/"')
    }
  })

  it('renders the not-found page in Turkish under /tr', async () => {
    const tr = await get('/tr/notes/missing-one')
    expect(tr.status).toBe(404)
    const body = await tr.text()
    expect(body).toContain('Sayfa bulunamadı')
    expect(body).toContain('<html lang="tr">')
    const en = await (await get('/notes/missing-one')).text()
    expect(en).toContain('Not found')
  })

  it('redirects the old Turkish URL to the new one after a slug change', async () => {
    const first = await savePost(db, null, post({ slug: 'tr-old', lang: 'tr' }))
    await savePost(db, first.id, post({ slug: 'tr-new', lang: 'tr', base_revision: first.revision }))
    const res = await get('/tr/notes/tr-old')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/tr/notes/tr-new')
    expect((await get('/notes/tr-old')).status).toBe(404)
  })

  it('redirects the old URL when a published post changes language', async () => {
    const first = await savePost(db, null, post({ slug: 'moves-lang' }))
    await savePost(db, first.id, post({ slug: 'moves-lang', lang: 'tr', base_revision: first.revision }))
    const res = await get('/notes/moves-lang')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/tr/notes/moves-lang')
  })

  it('keeps each language in its own feed', async () => {
    await savePost(db, null, post({ slug: 'feed-en', title: 'English feed item' }))
    await savePost(db, null, post({ slug: 'feed-tr', lang: 'tr', title: 'Turkce akis' }))
    const tr = await (await get('/tr/rss.xml')).text()
    expect(tr).toContain('Turkce akis')
    expect(tr).not.toContain('English feed item')
    expect(tr).toContain('https://ismailtarim.dev/tr/notes/feed-tr')
    const en = await (await get('/rss.xml')).text()
    expect(en).toContain('English feed item')
    expect(en).not.toContain('Turkce akis')
  })

  it('lists both languages in the sitemap and links translations as alternates', async () => {
    await savePost(db, null, post({ slug: 'map' }))
    await savePost(db, null, post({ slug: 'map', lang: 'tr' }))
    await savePost(db, null, post({ slug: 'map-solo', lang: 'tr' }))
    const xml = await (await get('/sitemap.xml')).text()
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(xml).toContain('<loc>https://ismailtarim.dev/notes/map</loc>')
    expect(xml).toContain('<loc>https://ismailtarim.dev/tr/notes/map</loc>')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="tr" href="https://ismailtarim.dev/tr/notes/map"/>')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://ismailtarim.dev/notes/map"/>')
    const solo = xml.match(/<url><loc>https:\/\/ismailtarim\.dev\/tr\/notes\/map-solo<\/loc>(.*?)<\/url>/)
    expect(solo?.[1]).toBe('')
    expect(xml).toContain('<loc>https://ismailtarim.dev/tr</loc>')
  })

  it('moves both languages when the slug of a published pair changes', async () => {
    const en = await savePost(db, null, post({ slug: 'pair-old' }))
    const tr = await savePost(db, null, post({ slug: 'pair-old', lang: 'tr', title: 'Cift' }))
    await savePost(db, en.id, post({ slug: 'pair-new', base_revision: en.revision }))

    expect((await slugOf(tr.id))).toBe('pair-new')
    const { results } = await db.prepare("SELECT from_path, to_path FROM redirects WHERE from_path LIKE '%/notes/pair-old' ORDER BY from_path").all()
    expect(results).toEqual([
      { from_path: '/notes/pair-old', to_path: '/notes/pair-new' },
      { from_path: '/tr/notes/pair-old', to_path: '/tr/notes/pair-new' },
    ])
    expect((await get('/tr/notes/pair-old')).headers.get('Location')).toBe('/tr/notes/pair-new')
    for (const path of ['/notes/pair-new', '/tr/notes/pair-new']) {
      const body = await (await get(path)).text()
      expect(body).toContain('rel="alternate" hreflang="en" href="https://ismailtarim.dev/notes/pair-new"')
      expect(body).toContain('rel="alternate" hreflang="tr" href="https://ismailtarim.dev/tr/notes/pair-new"')
    }
  })

  it('moves an unpublished translation along without a redirect', async () => {
    const en = await savePost(db, null, post({ slug: 'dtr-old' }))
    const tr = await savePost(db, null, post({ slug: 'dtr-old', lang: 'tr', status: 'draft', reason: 'save' }))
    await savePost(db, en.id, post({ slug: 'dtr-new', base_revision: en.revision }))
    expect((await slugOf(tr.id))).toBe('dtr-new')
    const row = await db.prepare("SELECT COUNT(*) AS n FROM redirects WHERE from_path = '/tr/notes/dtr-old'").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('leaves a published original alone when a draft translation renames itself', async () => {
    const en = await savePost(db, null, post({ slug: 'keep-orig' }))
    const tr = await savePost(db, null, post({ slug: 'keep-orig', lang: 'tr', status: 'draft', reason: 'save' }))
    await savePost(db, tr.id, post({ slug: 'keep-other', lang: 'tr', status: 'draft', reason: 'save', base_revision: tr.revision }))
    expect((await slugOf(en.id))).toBe('keep-orig')
  })

  it('rolls everything back when the translation cannot take the new slug', async () => {
    const en = await savePost(db, null, post({ slug: 'rb-old' }))
    const tr = await savePost(db, null, post({ slug: 'rb-old', lang: 'tr' }))
    await savePost(db, null, post({ slug: 'rb-taken', lang: 'tr' }))
    await expect(savePost(db, en.id, post({ slug: 'rb-taken', base_revision: en.revision }))).rejects.toThrow('UNIQUE constraint failed')
    expect((await slugOf(en.id))).toBe('rb-old')
    expect((await slugOf(tr.id))).toBe('rb-old')
    const row = await db.prepare("SELECT COUNT(*) AS n FROM redirects WHERE from_path LIKE '%/rb-old'").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('refuses a stale editor on the translation after the pair was renamed', async () => {
    const en = await savePost(db, null, post({ slug: 'stale-pair' }))
    const tr = await savePost(db, null, post({ slug: 'stale-pair', lang: 'tr' }))
    await savePost(db, en.id, post({ slug: 'stale-pair-2', base_revision: en.revision }))
    await expect(savePost(db, tr.id, post({ slug: 'stale-pair', lang: 'tr', base_revision: tr.revision }))).rejects.toThrow(ConflictError)
  })

  it('handles a slug and a language change in one save', async () => {
    const first = await savePost(db, null, post({ slug: 'both-a' }))
    await savePost(db, first.id, post({ slug: 'both-b', lang: 'tr', base_revision: first.revision }))
    const res = await get('/notes/both-a')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/tr/notes/both-b')
    expect((await get('/tr/notes/both-b')).status).toBe(200)
  })

  it('leaves no loop or stale row when a post flips en to tr and back', async () => {
    const a = await savePost(db, null, post({ slug: 'flip' }))
    const b = await savePost(db, a.id, post({ slug: 'flip', lang: 'tr', base_revision: a.revision }))
    await savePost(db, a.id, post({ slug: 'flip', lang: 'en', base_revision: b.revision }))
    const { results } = await db.prepare("SELECT from_path, to_path FROM redirects WHERE from_path LIKE '%/notes/flip'").all()
    expect(results).toEqual([{ from_path: '/tr/notes/flip', to_path: '/notes/flip' }])
    expect((await get('/notes/flip')).status).toBe(200)
  })

  it('retargets a redirect chain through a /tr path', async () => {
    const a = await savePost(db, null, post({ slug: 'chain-a', lang: 'tr' }))
    const b = await savePost(db, a.id, post({ slug: 'chain-b', lang: 'tr', base_revision: a.revision }))
    await savePost(db, a.id, post({ slug: 'chain-c', lang: 'tr', base_revision: b.revision }))
    const { results } = await db.prepare("SELECT from_path, to_path FROM redirects WHERE from_path LIKE '/tr/notes/chain-%' ORDER BY from_path").all()
    expect(results).toEqual([
      { from_path: '/tr/notes/chain-a', to_path: '/tr/notes/chain-c' },
      { from_path: '/tr/notes/chain-b', to_path: '/tr/notes/chain-c' },
    ])
  })

  it('drops a stale redirect when a post goes live on that path, so unpublishing cannot resurrect it', async () => {
    await db.prepare("INSERT INTO redirects (from_path, to_path) VALUES ('/notes/reborn', '/notes/elsewhere')").run()
    const first = await savePost(db, null, post({ slug: 'reborn' }))
    const row = await db.prepare("SELECT COUNT(*) AS n FROM redirects WHERE from_path = '/notes/reborn'").first<{ n: number }>()
    expect(row?.n).toBe(0)
    await savePost(db, first.id, post({ slug: 'reborn', status: 'draft', reason: 'save', base_revision: first.revision }))
    expect((await get('/notes/reborn')).status).toBe(404)
  })

  it('has tag pages only in languages that have posts, with alternates only when both do', async () => {
    await savePost(db, null, post({ slug: 'tag-en', tags: ['Zonly'] }))
    await savePost(db, null, post({ slug: 'tag-en2', tags: ['Zboth'] }))
    await savePost(db, null, post({ slug: 'tag-tr2', lang: 'tr', tags: ['Zboth'] }))

    expect((await get('/tr/tags/zonly')).status).toBe(404)
    const single = await (await get('/tags/zonly')).text()
    expect(single).not.toContain('rel="alternate" hreflang=')
    expect(single).toContain('class="lang-switch" href="/tr"')

    const both = await (await get('/tags/zboth')).text()
    expect(both).toContain('rel="alternate" hreflang="tr" href="https://ismailtarim.dev/tr/tags/zboth"')
    expect(both).toContain('class="lang-switch" href="/tr/tags/zboth"')
    expect((await (await get('/tr/tags/zonly')).text())).toContain('Sayfa bulunamadı')
  })

  it('keeps Turkish project pages out of hreflang and the sitemap and marks them noindex', async () => {
    await db
      .prepare("INSERT INTO projects (slug, name, summary, year, status, case_md, case_html, visible) VALUES ('proj-x', 'Proj X', 's', 2026, 'personal', 'c', '<p>c</p>', 1)")
      .run()
    const en = await (await get('/projects/proj-x')).text()
    const tr = await (await get('/tr/projects/proj-x')).text()
    expect(en).not.toContain('name="robots"')
    expect(tr).toContain('<meta name="robots" content="noindex"/>')
    for (const body of [en, tr, await (await get('/tr/projects')).text(), await (await get('/projects')).text()]) {
      expect(body).not.toContain('rel="alternate" hreflang=')
    }
    expect(tr).toContain('class="lang-switch" href="/projects/proj-x"')
    const xml = await (await get('/sitemap.xml')).text()
    expect(xml).toContain('<loc>https://ismailtarim.dev/projects/proj-x</loc>')
    expect(xml).not.toContain('/tr/projects')
  })
})
