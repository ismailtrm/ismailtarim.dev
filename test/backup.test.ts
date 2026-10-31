import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupDatabase, backupsToDelete } from '../src/backup'
import type { Env } from '../src/env'
import worker from '../src/index'

const e = env as unknown as Env
const self = (exports as unknown as { default: { fetch: (input: string) => Promise<Response> } }).default
const key = (d: string) => `backups/${d}.sql`

// Answers like D1's export API: a bookmark, then not ready once, then a URL.
function exportApi(dump = 'CREATE TABLE t(x);') {
  const calls: string[] = []
  let polls = 0
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://dump.example/x.sql') return new Response(dump)
    const body = JSON.parse(String(init?.body)) as { output_format?: string; current_bookmark?: string }
    if (body.output_format !== 'polling') return new Response('output_format required', { status: 400 })
    if (!body.current_bookmark) return Response.json({ result: { at_bookmark: 'b1', status: 'active' } })
    polls++
    return Response.json({
      result: polls === 1 ? { at_bookmark: 'b1', status: 'active' } : { at_bookmark: 'b1', status: 'complete', result: { signed_url: 'https://dump.example/x.sql' } },
    })
  }) as typeof fetch
  return { impl, calls }
}
const noWait = async () => {}

afterEach(async () => {
  const listed = await e.MEDIA.list({ prefix: 'backups/' })
  if (listed.objects.length) await e.MEDIA.delete(listed.objects.map((o) => o.key))
})

describe('backupsToDelete', () => {
  it('keeps the newest dailies and the first backup of each recent month', () => {
    const keys = ['2026-08-15', '2026-09-02', '2026-09-20', '2026-10-01', '2026-10-29', '2026-10-30', '2026-10-31'].map(key)
    expect(backupsToDelete(keys, 2, 2)).toEqual([key('2026-08-15'), key('2026-09-20'), key('2026-10-29')])
  })

  it('deletes nothing below the limits', () => {
    expect(backupsToDelete([key('2026-10-30')], 30, 12)).toEqual([])
  })
})

describe('backupDatabase', () => {
  it('stores the dump under a dated key', async () => {
    const api = exportApi()
    await backupDatabase({ ...e, D1_EXPORT_TOKEN: 't', CF_ACCOUNT_ID: 'acct' }, new Date('2026-10-31T02:17:00Z'), api.impl, noWait)
    const obj = await e.MEDIA.get(key('2026-10-31'))
    expect(await obj?.text()).toBe('CREATE TABLE t(x);')
    expect(api.calls[0]).toContain('/accounts/acct/d1/database/')
  })

  it('does nothing without a token', async () => {
    const api = exportApi()
    const { D1_EXPORT_TOKEN: _token, ...withoutToken } = e
    await backupDatabase(withoutToken, new Date(), api.impl, noWait)
    expect(api.calls).toEqual([])
  })

  it('fails loudly when the export never becomes ready', async () => {
    const never = (async () => Response.json({ result: { at_bookmark: 'b1' } })) as typeof fetch
    await expect(backupDatabase({ ...e, D1_EXPORT_TOKEN: 't' }, new Date(), never, noWait)).rejects.toThrow('timed out')
  })

  it('reports an error returned by the last poll', async () => {
    let calls = 0
    const late = (async () => Response.json({ result: { at_bookmark: 'b1', ...(++calls === 31 ? { error: 'dump failed' } : {}) } })) as typeof fetch
    await expect(backupDatabase({ ...e, D1_EXPORT_TOKEN: 'test' }, new Date(), late, noWait)).rejects.toThrow('dump failed')
  })

  it('is not reachable through /media', async () => {
    await e.MEDIA.put(key('2026-10-31'), 'secret')
    expect((await self.fetch(`https://ismailtarim.dev/media/${key('2026-10-31')}`)).status).toBe(404)
  })
})

describe('scheduled', () => {
  it('logs why each job failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => new Response('forbidden', { status: 403 }))
    try {
      const failing = { ...e, AE_API_TOKEN: 'test', CF_ACCOUNT_ID: 'acct', D1_EXPORT_TOKEN: 'test' }
      await expect(worker.scheduled({} as ScheduledController, failing)).rejects.toThrow('scheduled job failed')
      const logged = log.mock.calls.map((c) => String(c[0]))
      expect(logged.some((m) => m.includes('read rollup failed') && m.includes('403'))).toBe(true)
      expect(logged.some((m) => m.includes('D1 export 403'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      log.mockRestore()
    }
  })
})

describe('error pages', () => {
  it('are not cached when a query fails', async () => {
    const broken = { ...e, DB: { prepare: () => { throw new Error('D1 down') } } as unknown as D1Database }
    const res = await worker.fetch(new Request('https://ismailtarim.dev/'), broken, {} as ExecutionContext)
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
