import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AchievementInput } from '../src/admin/schema'
import { deleteAchievement, getAchievementForEdit, saveAchievement } from '../src/admin/achievement-store'
import { ConflictError } from '../src/admin/store'

const db = (env as unknown as { DB: D1Database }).DB
const worker = (exports as unknown as { default: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }).default
const get = (path: string) => worker.fetch(`https://ismailtarim.dev${path}`, { redirect: 'manual' })
const admin = (path: string, method = 'GET', body?: unknown) =>
  worker.fetch(`http://localhost/admin/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function item(overrides: Partial<AchievementInput> = {}): AchievementInput {
  return {
    kind: 'award',
    title: 'Hackathon finalist',
    context: 'Teknofest',
    outcome: '2nd in Turkey',
    summary: 'Built a thing in 48 hours',
    year: 2025,
    sort_order: 0,
    visible: true,
    project_id: null,
    base_updated_at: null,
    links: [{ label: 'Result', url: 'https://example.com/result' }],
    ...overrides,
  }
}

beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM achievements'), db.prepare('DELETE FROM posts')])
})

describe('public awards page', () => {
  it('never shows hidden rows on the page or in the sitemap', async () => {
    await saveAchievement(db, null, item({ title: 'Hidden award', visible: false }))
    const html = await (await get('/awards')).text()
    expect(html).not.toContain('Hidden award')
    expect(await (await get('/sitemap.xml')).text()).not.toContain('/awards')
    await saveAchievement(db, null, item({ title: 'Shown award' }))
    expect(await (await get('/sitemap.xml')).text()).toContain('<loc>https://ismailtarim.dev/awards</loc>')
    const after = await (await get('/awards')).text()
    expect(after).toContain('Shown award')
    expect(after).not.toContain('Hidden award')
  })

  it('renders each item with its fields and links', async () => {
    await saveAchievement(db, null, item())
    const html = await (await get('/awards')).text()
    expect(html).toContain('<h1>Awards and contributions</h1>')
    for (const text of ['Hackathon finalist', 'Teknofest', '2nd in Turkey', '2025', 'Built a thing in 48 hours']) expect(html).toContain(text)
    expect(html).toContain('href="https://example.com/result"')
  })

  it('shows a section only when it has visible rows, ordered by sort_order then year descending', async () => {
    await saveAchievement(db, null, item({ title: 'Award old', year: 2020 }))
    await saveAchievement(db, null, item({ title: 'Award new', year: 2024 }))
    await saveAchievement(db, null, item({ title: 'Award first', year: 2010, sort_order: -1 }))
    let html = await (await get('/awards')).text()
    expect(html).toContain('<h2>Awards</h2>')
    expect(html).not.toContain('<h2>Contributions</h2>')
    expect(html.indexOf('Award first')).toBeLessThan(html.indexOf('Award new'))
    expect(html.indexOf('Award new')).toBeLessThan(html.indexOf('Award old'))
    await saveAchievement(db, null, item({ kind: 'contribution', title: 'Kernel patch', outcome: 'merged in Linux 7.3' }))
    await saveAchievement(db, null, item({ kind: 'contribution', title: 'Hidden patch', visible: false }))
    html = await (await get('/awards')).text()
    expect(html).toContain('<h2>Contributions</h2>')
    expect(html).toContain('merged in Linux 7.3')
    expect(html).not.toContain('Hidden patch')
    expect(html.indexOf('<h2>Awards</h2>')).toBeLessThan(html.indexOf('<h2>Contributions</h2>'))
  })

  it('shows a muted empty message when nothing is visible', async () => {
    const en = await (await get('/awards')).text()
    expect(en).toContain('<p class="muted">No awards or contributions listed yet.</p>')
    expect(en).not.toContain('<h2>')
    expect(await (await get('/tr/awards')).text()).toContain('<p class="muted">Henüz listelenmiş ödül veya katkı yok.</p>')
  })

  it('filters unsafe link urls', async () => {
    await db
      .prepare("INSERT INTO achievements (kind, title, year, visible, links) VALUES ('award', 'T', 2025, 1, ?)")
      .bind('[{"label":"bad","url":"javascript:alert(1)"},{"label":"good","url":"https://example.com/ok"}]')
      .run()
    const html = await (await get('/awards')).text()
    expect(html).not.toContain('javascript:')
    expect(html).toContain('https://example.com/ok')
  })

  it('serves /tr/awards as noindex without hreflang, with a switch back to English', async () => {
    await saveAchievement(db, null, item())
    const tr = await (await get('/tr/awards')).text()
    expect(tr).toContain('<html lang="tr">')
    expect(tr).toContain('Ödüller ve katkılar')
    expect(tr).toContain('Hackathon finalist')
    expect(tr).toContain('<meta name="robots" content="noindex"/>')
    expect(tr).not.toContain('<link rel="alternate" hreflang')
    expect(tr).toContain('href="/awards" hreflang="en"')
    const en = await (await get('/awards')).text()
    expect(en).not.toContain('<meta name="robots"')
    expect(en).not.toContain('class="lang-switch"')
    expect(await (await get('/sitemap.xml')).text()).not.toContain('/tr/awards')
  })

  it('shows the awards crumb in the header', async () => {
    expect(await (await get('/awards')).text()).toContain('class="wordmark crumb" href="/awards"')
    expect(await (await get('/tr/awards')).text()).toContain('class="wordmark crumb" href="/tr/awards"')
  })

  it('links Awards in the main nav of other pages, between Projects and the language switch', async () => {
    expect(await (await get('/projects')).text()).toContain('<a href="/awards">Awards</a>')
    const tr = await (await get('/tr/projects')).text()
    expect(tr.indexOf('href="/tr/projects"')).toBeLessThan(tr.indexOf('href="/tr/awards"'))
    expect(tr.indexOf('href="/tr/awards"')).toBeLessThan(tr.indexOf('class="lang-switch"'))
    expect(await (await get('/tr/notes')).text()).toContain('<a href="/tr/awards">Ödüller</a>')
  })
})

describe('achievements admin API', () => {
  it('rejects unauthenticated requests', async () => {
    for (const path of ['/achievements', '/achievements/1']) {
      expect((await worker.fetch(`https://ismailtarim.dev/admin/api${path}`)).status).toBe(401)
    }
    const post = await worker.fetch('https://ismailtarim.dev/admin/api/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(post.status).toBe(401)
  })

  it('validates input before writing', async () => {
    expect((await admin('/achievements', 'POST', item({ title: '  ' }))).status).toBe(400)
    expect((await admin('/achievements', 'POST', { ...item(), kind: 'prize' })).status).toBe(400)
    expect((await admin('/achievements', 'POST', item({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }))).status).toBe(400)
    expect((await admin('/achievements', 'POST', item({ links: [{ label: 'x', url: 'mailto:a@b.co' }] }))).status).toBe(400)
    expect((await admin('/achievements', 'POST', item({ year: 1800 }))).status).toBe(400)
    expect((await admin('/achievements', 'POST', 'nope')).status).toBe(400)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM achievements').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('creates, reads, lists hidden rows, updates and deletes over HTTP', async () => {
    const created = await admin('/achievements', 'POST', item({ visible: false }))
    expect(created.status).toBe(201)
    const { id, updated_at } = (await created.json()) as { id: number; updated_at: string }
    const list = (await (await admin('/achievements')).json()) as { id: number; title: string; visible: number }[]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, title: 'Hackathon finalist', visible: 0 })
    const one = (await (await admin(`/achievements/${id}`)).json()) as Record<string, unknown>
    expect(one).toMatchObject({ id, visible: false, updated_at, links: [{ label: 'Result', url: 'https://example.com/result' }] })
    const put = await admin(`/achievements/${id}`, 'PUT', item({ title: 'Renamed', base_updated_at: updated_at }))
    expect(put.status).toBe(200)
    expect((await getAchievementForEdit(db, id))?.title).toBe('Renamed')
    expect((await admin(`/achievements/${id}`, 'DELETE')).status).toBe(200)
    expect((await admin(`/achievements/${id}`)).status).toBe(404)
    expect((await admin(`/achievements/${id}`, 'DELETE')).status).toBe(404)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM achievements').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('rejects a project that does not exist', async () => {
    expect((await admin('/achievements', 'POST', item({ project_id: 9999 }))).status).toBe(400)
  })

  it('answers 404 for a bad id', async () => {
    expect((await admin('/achievements/abc')).status).toBe(404)
    expect((await admin('/achievements/999', 'PUT', item())).status).toBe(409)
  })
})

describe('achievement optimistic lock', () => {
  it('rejects a stale save with 409', async () => {
    const first = await saveAchievement(db, null, item())
    await saveAchievement(db, first.id, item({ title: 'tab one', base_updated_at: first.updated_at }))
    await expect(saveAchievement(db, first.id, item({ title: 'tab two', base_updated_at: first.updated_at }))).rejects.toThrow(ConflictError)
    const res = await admin(`/achievements/${first.id}`, 'PUT', item({ title: 'tab three', base_updated_at: first.updated_at }))
    expect(res.status).toBe(409)
    expect((await getAchievementForEdit(db, first.id))?.title).toBe('tab one')
  })

  it('lets only one of two concurrent saves through', async () => {
    const first = await saveAchievement(db, null, item())
    const outcomes = await Promise.allSettled([
      saveAchievement(db, first.id, item({ title: 'a', base_updated_at: first.updated_at })),
      saveAchievement(db, first.id, item({ title: 'b', base_updated_at: first.updated_at })),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
  })

  it('answers 409 when the row was deleted meanwhile', async () => {
    const first = await saveAchievement(db, null, item())
    await deleteAchievement(db, first.id)
    const res = await admin(`/achievements/${first.id}`, 'PUT', item({ base_updated_at: first.updated_at }))
    expect(res.status).toBe(409)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM achievements').first<{ n: number }>()).toEqual({ n: 0 })
  })
})
