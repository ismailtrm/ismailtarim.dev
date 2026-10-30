import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { PostInput } from '../src/admin/schema'
import { ConflictError, getPostForEdit, listRevisions, savePost } from '../src/admin/store'

const db = (env as unknown as { DB: D1Database }).DB
const worker = (exports as unknown as { default: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }).default

function draft(overrides: Partial<PostInput> = {}): PostInput {
  return {
    kind: 'note',
    slug: 'nm-no-secret-agent',
    title: 'NetworkManager never asks for the Wi-Fi password',
    summary: null,
    lang: 'en',
    status: 'draft',
    published_at: null,
    body_md: '# hi',
    body_html: '<h1>hi</h1>',
    og_key: null,
    tags: ['Linux', 'NetworkManager'],
    note: { symptom: 'secret required but not provided', fix: 'run a secret agent', environment: { distro: 'Arch' }, verified_at: '2026-09-18' },
    reason: 'save',
    base_revision: null,
    ...overrides,
  }
}

describe('savePost', () => {
  it('creates a post with its tags, note box and first revision', async () => {
    const { id } = await savePost(db, null, draft())
    const post = await getPostForEdit(db, id)
    expect(post?.tags).toEqual(['Linux', 'NetworkManager'])
    expect(post?.note).toMatchObject({ fix: 'run a secret agent', environment: { distro: 'Arch' } })
    expect(await listRevisions(db, id)).toHaveLength(1)
  })

  it('refuses a save based on a stale copy of the post', async () => {
    const { id, revision } = await savePost(db, null, draft({ slug: 'stale' }))
    await savePost(db, id, draft({ slug: 'stale', title: 'first edit', base_revision: revision }))
    await expect(savePost(db, id, draft({ slug: 'stale', title: 'second tab', base_revision: revision }))).rejects.toThrow(
      ConflictError,
    )
  })

  it('lets only one of two concurrent saves from the same revision through', async () => {
    const { id, revision } = await savePost(db, null, draft({ slug: 'race' }))
    const outcomes = await Promise.allSettled([
      savePost(db, id, draft({ slug: 'race', title: 'tab one', base_revision: revision })),
      savePost(db, id, draft({ slug: 'race', title: 'tab two', base_revision: revision })),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((o) => o.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError)
    expect(await listRevisions(db, id)).toHaveLength(2)
  })

  it('keeps the first spelling of a shared tag', async () => {
    await savePost(db, null, draft({ slug: 'tag-a', tags: ['Linux'] }))
    await savePost(db, null, draft({ slug: 'tag-b', tags: ['linux'] }))
    const row = await db.prepare("SELECT name FROM tags WHERE slug = 'linux'").first<{ name: string }>()
    expect(row?.name).toBe('Linux')
  })

  it('keeps the old URL of a published post working after a slug change', async () => {
    const first = await savePost(db, null, draft({ slug: 'old-name', status: 'published', reason: 'publish' }))
    const second = await savePost(db, first.id, draft({ slug: 'new-name', status: 'published', base_revision: first.revision }))
    await savePost(db, first.id, draft({ slug: 'newest-name', status: 'published', base_revision: second.revision }))

    const { results } = await db.prepare('SELECT from_path, to_path FROM redirects ORDER BY from_path').all()
    expect(results).toEqual([
      { from_path: '/notes/new-name', to_path: '/notes/newest-name' },
      { from_path: '/notes/old-name', to_path: '/notes/newest-name' },
    ])
  })

  it('does not record redirects for drafts', async () => {
    const first = await savePost(db, null, draft({ slug: 'draft-a' }))
    await savePost(db, first.id, draft({ slug: 'draft-b', base_revision: first.revision }))
    const row = await db.prepare("SELECT COUNT(*) AS n FROM redirects WHERE from_path = '/notes/draft-a'").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('drops the note box when a note becomes an essay', async () => {
    const first = await savePost(db, null, draft({ slug: 'becomes-essay' }))
    await savePost(db, first.id, draft({ slug: 'becomes-essay', kind: 'writing', note: null, base_revision: first.revision }))
    expect((await getPostForEdit(db, first.id))?.note).toBeNull()
  })
})

describe('admin API', () => {
  it('rejects requests without an Access token on the real hostname', async () => {
    const res = await worker.fetch('https://ismailtarim.dev/admin/api/posts')
    expect(res.status).toBe(401)
  })

  it('rejects a forged Access token', async () => {
    const res = await worker.fetch('https://ismailtarim.dev/admin/api/posts', {
      headers: { 'Cf-Access-Jwt-Assertion': 'e30.e30.' },
    })
    expect(res.status).toBe(403)
  })

  it('rejects tags that collapse to the same slug', async () => {
    const res = await worker.fetch('http://localhost/admin/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify(draft({ slug: 'tags-collide', tags: ['C++', 'C#'] })),
    })
    expect(res.status).toBe(400)
  })

  it('reports a slug taken by another post as a conflict', async () => {
    const send = () =>
      worker.fetch('http://localhost/admin/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify(draft({ slug: 'taken' })),
      })
    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(409)
  })

  it('validates posts before writing them', async () => {
    const res = await worker.fetch('http://localhost/admin/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({ ...draft(), kind: 'writing' }),
    })
    expect(res.status).toBe(400)
  })
})
