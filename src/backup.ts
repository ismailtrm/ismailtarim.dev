import type { Env } from './env'

const PREFIX = 'backups/'
const POLL_ATTEMPTS = 30
const POLL_INTERVAL_MS = 2000

// Which backups to keep: the newest `daily`, plus the earliest one of each of the newest `monthly` months.
// Keys sort by date because they are backups/YYYY-MM-DD.sql.
export function backupsToDelete(keys: string[], daily: number, monthly: number): string[] {
  const sorted = [...keys].sort()
  const keep = new Set(sorted.slice(-daily))
  const firstOfMonth = new Map<string, string>()
  for (const key of sorted) {
    const month = key.slice(PREFIX.length, PREFIX.length + 7)
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, key)
  }
  for (const key of [...firstOfMonth.values()].slice(-monthly)) keep.add(key)
  return sorted.filter((key) => !keep.has(key))
}

function count(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

type ExportResult = { at_bookmark?: string; signed_url?: string; error?: string }

// D1's export API: the first call starts a dump and returns a bookmark, later calls with it return the URL when ready.
async function exportSql(env: Env, token: string, fetchImpl: typeof fetch, wait: (ms: number) => Promise<void>): Promise<Response> {
  const call = async (body: object): Promise<ExportResult> => {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}/export`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`D1 export ${res.status}`)
    return ((await res.json()) as { result?: ExportResult }).result ?? {}
  }
  const started = await call({ output_format: 'polling' })
  if (!started.at_bookmark) throw new Error('D1 export returned no bookmark')
  let result = started
  for (let i = 0; i < POLL_ATTEMPTS && !result.signed_url; i++) {
    if (result.error) throw new Error(`D1 export: ${result.error}`)
    await wait(POLL_INTERVAL_MS)
    result = await call({ current_bookmark: started.at_bookmark })
  }
  if (!result.signed_url) throw new Error('D1 export timed out')
  const dump = await fetchImpl(result.signed_url)
  if (!dump.ok) throw new Error(`D1 export download ${dump.status}`)
  return dump
}

// Nightly SQL dump into R2, outside the img/ prefix that /media serves, so it is never public.
export async function backupDatabase(
  env: Env,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => scheduler.wait(ms),
): Promise<void> {
  if (!env.D1_EXPORT_TOKEN) {
    console.warn('backup skipped: D1_EXPORT_TOKEN is not set')
    return
  }
  const dump = await exportSql(env, env.D1_EXPORT_TOKEN, fetchImpl, wait)
  const key = `${PREFIX}${now.toISOString().slice(0, 10)}.sql`
  // A dump's length is known only after buffering when the response is not fixed-length; R2 needs it.
  await env.MEDIA.put(key, await dump.arrayBuffer(), { httpMetadata: { contentType: 'application/sql' } })
  const listed = await env.MEDIA.list({ prefix: PREFIX, limit: 1000 })
  const stale = backupsToDelete(listed.objects.map((o) => o.key), count(env.BACKUP_KEEP_DAILY, 30), count(env.BACKUP_KEEP_MONTHLY, 12))
  if (stale.length) await env.MEDIA.delete(stale)
}
