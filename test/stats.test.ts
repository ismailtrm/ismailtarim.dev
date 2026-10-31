import { env, exports } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { OWNER_COOKIE, classifyAgent, readStats, recordRead, rollupDay, rollupRecent } from '../src/stats'

const e = env as unknown as Env
const worker = (exports as unknown as { default: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }).default

describe('classifyAgent', () => {
  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'ai', 'GPTBot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'ai', 'OAI-SearchBot'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ai', 'ClaudeBot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0)', 'ai', 'PerplexityBot'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search', 'Googlebot'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'human', 'browser'],
    ['curl/8.10.1', 'bot', 'curl'],
    ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'bot', 'ahrefsbot'],
    ['Mozilla/5.0 HeadlessChrome/120.0', 'bot', 'headlesschrome'],
    ['x1bot/1.0', 'bot', 'other'],
    ['', 'bot', 'empty'],
  ])('%s', (ua, cls, agent) => {
    expect(classifyAgent(ua)).toEqual({ cls, agent })
  })
})

describe('rollupDay', () => {
  const day = '2026-10-29'
  const answer = (rows: object[], sources: object[] = [], total: object[] = []) =>
    (async (_url: string, init: RequestInit) => {
      const sql = String(init.body)
      return Response.json({ data: sql.includes('AS path') ? rows : sql.includes('AS source') ? sources : total })
    }) as unknown as typeof fetch
  const withToken = { ...e, AE_API_TOKEN: 'test', CF_ACCOUNT_ID: 'acct' }

  it('does nothing without a token', async () => {
    const { AE_API_TOKEN: _, ...noToken } = e
    expect(await rollupDay(noToken, day, answer([]))).toBe(0)
  })

  it('copies a day into D1 and replaces it on a re-run', async () => {
    await rollupDay(withToken, day, answer([{ path: '/notes/x', cls: 'ai', agent: 'GPTBot', country: 'US', n: '3' }]))
    await rollupDay(withToken, day, answer([
      { path: '/notes/x', cls: 'ai', agent: 'GPTBot', country: 'US', n: '5' },
      { path: '/notes/x', cls: 'human', agent: 'browser', country: 'TR', n: 2 },
    ]))
    const stats = await readStats(e.DB, day)
    expect(stats.byPath).toEqual([
      { path: '/notes/x', client_class: 'ai', reads: 5 },
      { path: '/notes/x', client_class: 'human', reads: 2 },
    ])
  })

  it('surfaces a failed query instead of writing an empty day', async () => {
    const fail = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    await expect(rollupDay(withToken, day, fail)).rejects.toThrow('403')
  })

  it('copies visitors and sources, and a re-run replaces them', async () => {
    const d = '2026-10-20'
    await rollupDay(withToken, d, answer([], [{ source: 'old', campaign: '', n: '9', v: '9' }], [{ n: '9', v: '9' }]))
    await rollupDay(withToken, d, answer([], [{ source: 'linkedin', campaign: 'kernel', n: '5', v: '3' }], [{ n: '7', v: '4' }]))
    const stats = await readStats(e.DB, d)
    expect(stats.visitors).toContainEqual({ day: d, visitors: 4 })
    expect(stats.sources).toContainEqual({ source: 'linkedin', campaign: 'kernel', reads: 5, visitor_days: 3 })
    expect(stats.sources.some((x) => x.source === 'old')).toBe(false)
  })
})

describe('robots.txt', () => {
  it('allows crawlers and states the content signals', async () => {
    const res = await worker.fetch('https://ismailtarim.dev/robots.txt')
    const body = await res.text()
    expect(body).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes')
    expect(body).toContain('Sitemap: https://ismailtarim.dev/sitemap.xml')
  })
})

describe('recordRead', () => {
  function capture() {
    const points: AnalyticsEngineDataPoint[] = []
    return { env: { ...e, READS: { writeDataPoint: (p?: AnalyticsEngineDataPoint) => p && points.push(p) } }, points }
  }
  const get = (ua = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', method = 'GET') =>
    new Request('https://ismailtarim.dev/x', { method, headers: { 'User-Agent': ua } })

  const person = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers: { 'User-Agent': 'Mozilla/5.0 Firefox/140.0', 'CF-Connecting-IP': '203.0.113.9', ...headers } })
  const count = (req: Request, en: Env, now?: Date) => recordRead(en, req, new URL(req.url).pathname, 200, now)

  it.each(['/about', '/awards', '/tr/about', '/tr/awards'])('counts %s', async (path) => {
    const { env: en, points } = capture()
    await recordRead(en, get(), path, 200)
    expect(points).toHaveLength(1)
  })

  it('takes the source and campaign from UTM, lower-cased, over the Referer', async () => {
    const { env: en, points } = capture()
    await count(person('https://ismailtarim.dev/notes?utm_source=LinkedIn&utm_campaign=kernel-post', { Referer: 'https://lnkd.in/x' }), en)
    expect(points[0]?.blobs?.slice(4, 6)).toEqual(['linkedin', 'kernel-post'])
  })

  it.each([
    ['https://www.google.com/search', 'google.com'],
    ['https://ismailtarim.dev/notes', 'direct'],
    ['not a url', 'direct'],
  ])('reads the source from Referer %s', async (referer, source) => {
    const { env: en, points } = capture()
    await count(person('https://ismailtarim.dev/notes', { Referer: referer }), en)
    expect(points[0]?.blobs?.[4]).toBe(source)
  })

  it('ignores a UTM value that is not a plain label', async () => {
    const { env: en, points } = capture()
    await count(person('https://ismailtarim.dev/notes?utm_source=%3Cscript%3E'), en)
    expect(points[0]?.blobs?.[4]).toBe('direct')
  })

  it('gives one person the same visitor within a day and another the next day, without the IP', async () => {
    const { env: en, points } = capture()
    const keyed = { ...en, AE_API_TOKEN: 'test' }
    await count(person('https://ismailtarim.dev/notes'), keyed, new Date('2026-10-31T01:00:00Z'))
    await count(person('https://ismailtarim.dev/writing'), keyed, new Date('2026-10-31T23:00:00Z'))
    await count(person('https://ismailtarim.dev/notes'), keyed, new Date('2026-11-01T01:00:00Z'))
    const [a, b, c] = points.map((p) => String(p.blobs?.[6]))
    expect(a).toMatch(/^[0-9a-f]{24}$/)
    expect(b).toBe(a)
    expect(c).not.toBe(a)
    expect(JSON.stringify(points)).not.toContain('203.0.113.9')
  })

  it('stores no source or visitor for a crawler', async () => {
    const { env: en, points } = capture()
    await count(new Request('https://ismailtarim.dev/notes?utm_source=spam', { headers: { 'User-Agent': 'GPTBot/1.2' } }), { ...en, AE_API_TOKEN: 'test' })
    expect(points[0]?.blobs?.slice(4)).toEqual(['', '', ''])
  })

  it.each(['/robots.txt', '/llms.txt', '/sitemap.xml', '/rss.xml', '/tr/rss.xml'])('never counts %s as a person, even with a browser User-Agent', async (path) => {
    const { env: en, points } = capture()
    await recordRead({ ...en, AE_API_TOKEN: 'test' }, person(`https://ismailtarim.dev${path}?utm_source=x`), path, 200)
    expect(points[0]?.blobs?.slice(1, 3)).toEqual(['bot', 'browser-ua'])
    expect(points[0]?.blobs?.slice(4)).toEqual(['', '', ''])
  })

  it('skips the owner', async () => {
    const { env: en, points } = capture()
    await count(person('https://ismailtarim.dev/notes', { Cookie: `a=b; ${OWNER_COOKIE}=1` }), en)
    expect(points).toEqual([])
  })

  it('counts a canonical page with its class and agent', async () => {
    const { env: en, points } = capture()
    await recordRead(en, get('GPTBot/1.2'), '/notes/abc/', 200)
    expect(points).toEqual([{ indexes: ['/notes/abc'], blobs: ['/notes/abc', 'ai', 'GPTBot', 'XX', '', '', ''], doubles: [1] }])
  })

  it.each(['/tr', '/tr/', '/tr/notes', '/tr/notes/ssh-dscp-ef', '/tr/tags/linux', '/tr/rss.xml'])('counts the Turkish page %s', async (path) => {
    const { env: en, points } = capture()
    await recordRead(en, get(), path, 200)
    expect(points).toHaveLength(1)
    expect(points[0]?.blobs?.[0]).toBe(path.replace(/\/+$/, ''))
  })

  it.each([
    ['/tr/', '/tr'],
    ['/notes/', '/notes'],
    ['/tr/notes/', '/tr/notes'],
  ])('counts %s as %s', async (path, counted) => {
    const { env: en, points } = capture()
    await recordRead(en, get(), path, 200)
    expect(points[0]?.blobs?.[0]).toBe(counted)
  })

  it.each([
    ['a non-200 response', '/notes/abc', 404, 'GET'],
    ['a HEAD request', '/notes/abc', 200, 'HEAD'],
    ['a non-canonical path', '/notes/ABC', 200, 'GET'],
    ['an admin path', '/admin/api/posts', 200, 'GET'],
    ['a path that only starts like a page', '/notesXYZ', 200, 'GET'],
    ['a Turkish path that only starts like a page', '/trnotes', 200, 'GET'],
    ['a Turkish path with an unknown page', '/tr/admin', 200, 'GET'],
    ['a non-canonical Turkish path', '/tr/notes/ABC', 200, 'GET'],
  ])('skips %s', async (_name, path, status, method) => {
    const { env: en, points } = capture()
    await recordRead(en, get(undefined, method), path, status)
    expect(points).toEqual([])
  })

  it('gets the decoded path from Hono, so encoded variants share one row', async () => {
    const app = new Hono()
    app.get('/notes/:slug{[a-z0-9-]+}', (c) => c.text(c.req.path))
    expect(await (await app.request('/notes/%61bc')).text()).toBe('/notes/abc')
  })
})

describe('rollupRecent', () => {
  it('copies the other days when one day fails, then reports the failure', async () => {
    const withToken = { ...e, AE_API_TOKEN: 'test', CF_ACCOUNT_ID: 'acct' }
    let call = 0
    const flaky = (async (_url: string, init: RequestInit) => {
      call++
      if (call === 1) return new Response('boom', { status: 500 })
      return Response.json({ data: String(init.body).includes('AS path') ? [{ path: '/', cls: 'human', agent: 'browser', country: 'DE', n: '1' }] : [] })
    }) as unknown as typeof fetch
    await expect(rollupRecent(withToken, new Date('2026-09-04T03:00:00Z'), 3, flaky)).rejects.toThrow('2026-09-01')
    const stats = await readStats(e.DB, '2026-09-02')
    expect(stats.byCountry).toContainEqual({ country: 'DE', client_class: 'human', reads: 2 })
  })
})
