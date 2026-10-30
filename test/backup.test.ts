import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
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
    const body = JSON.parse(String(init?.body)) as { current_bookmark?: string }
    if (!body.current_bookmark) return Response.json({ result: { at_bookmark: 'b1' } })
    polls++
    return Response.json({ result: polls === 1 ? { at_bookmark: 'b1' } : { signed_url: 'https://dump.example/x.sql' } })
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

  it('is not reachable through /media', async () => {
    await e.MEDIA.put(key('2026-10-31'), 'secret')
    expect((await self.fetch(`https://ismailtarim.dev/media/${key('2026-10-31')}`)).status).toBe(404)
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
