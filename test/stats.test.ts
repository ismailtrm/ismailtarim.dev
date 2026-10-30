import { env, exports } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { classifyAgent, readStats, recordRead, rollupDay, rollupRecent } from '../src/stats'

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
    ['curl/8.10.1', 'bot', 'other'],
    ['', 'bot', 'empty'],
  ])('%s', (ua, cls, agent) => {
    expect(classifyAgent(ua)).toEqual({ cls, agent })
  })
})

describe('rollupDay', () => {
  const day = '2026-10-29'
  const answer = (rows: object[]) => (async () => Response.json({ data: rows })) as unknown as typeof fetch
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

  it('counts a canonical page with its class and agent', () => {
    const { env: en, points } = capture()
    recordRead(en, get('GPTBot/1.2'), '/notes/abc/', 200)
    expect(points).toEqual([{ indexes: ['/notes/abc'], blobs: ['/notes/abc', 'ai', 'GPTBot', 'XX'], doubles: [1] }])
  })

  it.each(['/tr', '/tr/', '/tr/notes', '/tr/notes/ssh-dscp-ef', '/tr/tags/linux', '/tr/rss.xml'])('counts the Turkish page %s', (path) => {
    const { env: en, points } = capture()
    recordRead(en, get(), path, 200)
    expect(points).toHaveLength(1)
    expect(points[0]?.blobs?.[0]).toBe(path.replace(/\/+$/, ''))
  })

  it.each([
    ['/tr/', '/tr'],
    ['/notes/', '/notes'],
    ['/tr/notes/', '/tr/notes'],
  ])('counts %s as %s', (path, counted) => {
    const { env: en, points } = capture()
    recordRead(en, get(), path, 200)
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
  ])('skips %s', (_name, path, status, method) => {
    const { env: en, points } = capture()
    recordRead(en, get(undefined, method), path, status)
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
    const flaky = (async () => {
      call++
      if (call === 1) return new Response('boom', { status: 500 })
      return Response.json({ data: [{ path: '/', cls: 'human', agent: 'browser', country: 'DE', n: '1' }] })
    }) as unknown as typeof fetch
    await expect(rollupRecent(withToken, new Date('2026-09-04T03:00:00Z'), 3, flaky)).rejects.toThrow('2026-09-01')
    const stats = await readStats(e.DB, '2026-09-02')
    expect(stats.byCountry).toContainEqual({ country: 'DE', client_class: 'human', reads: 2 })
  })
})
