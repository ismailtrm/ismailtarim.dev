import type { Env } from './env'

// Reads are counted on the server, so crawlers that never run JavaScript show up too.
// The client is guessed from User-Agent only: Bot Management fields stay empty on the Free plan,
// and a User-Agent can be forged, so these numbers are a classification, not proof.

export type ClientClass = 'human' | 'ai' | 'search' | 'bot'

// Order matters: the first pattern that matches names the agent.
const AI: [RegExp, string][] = [
  [/OAI-SearchBot/i, 'OAI-SearchBot'],
  [/ChatGPT-User/i, 'ChatGPT-User'],
  [/GPTBot/i, 'GPTBot'],
  [/Claude-SearchBot/i, 'Claude-SearchBot'],
  [/Claude-User/i, 'Claude-User'],
  [/ClaudeBot|anthropic-ai/i, 'ClaudeBot'],
  [/Perplexity-User/i, 'Perplexity-User'],
  [/PerplexityBot/i, 'PerplexityBot'],
  [/Google-CloudVertexBot/i, 'Google-CloudVertexBot'],
  [/meta-externalagent|meta-externalfetcher/i, 'Meta'],
  [/CCBot/i, 'CCBot'],
  [/Bytespider/i, 'Bytespider'],
  [/Amazonbot/i, 'Amazonbot'],
  [/cohere-ai/i, 'Cohere'],
  [/MistralAI-User/i, 'MistralAI-User'],
  [/DuckAssistBot/i, 'DuckAssistBot'],
  [/YouBot/i, 'YouBot'],
  [/Diffbot/i, 'Diffbot'],
]

const SEARCH: [RegExp, string][] = [
  [/Googlebot/i, 'Googlebot'],
  [/bingbot/i, 'Bingbot'],
  [/DuckDuckBot/i, 'DuckDuckBot'],
  [/YandexBot/i, 'YandexBot'],
  [/Baiduspider/i, 'Baiduspider'],
  [/Applebot/i, 'Applebot'],
]

const GENERIC_BOT = /bot|crawl|spider|slurp|curl|wget|python|httpx|go-http-client|java\/|okhttp|headless|feed|scrapy|node-fetch|axios/i

export function classifyAgent(ua: string | null | undefined): { cls: ClientClass; agent: string } {
  const s = ua ?? ''
  for (const [re, name] of AI) if (re.test(s)) return { cls: 'ai', agent: name }
  for (const [re, name] of SEARCH) if (re.test(s)) return { cls: 'search', agent: name }
  if (!s || GENERIC_BOT.test(s) || !/Mozilla\//.test(s)) return { cls: 'bot', agent: s ? 'other' : 'empty' }
  return { cls: 'human', agent: 'browser' }
}

// Only canonical page and feed paths are counted, English at the root and Turkish under /tr.
// The path is the one Hono routed on (already percent-decoded), so /notes/%61bc and /notes/abc land on one row instead of inventing new ones.
const SLUGGED = '[a-z0-9-]{1,120}'
const COUNTED = new RegExp(
  `^(?:/(?:tr)?|(?:/tr)?/(?:notes|writing|projects|(?:notes|writing|projects|tags)/${SLUGGED}|rss\\.xml)|/(?:sitemap\\.xml|llms\\.txt|robots\\.txt))$`,
)

// Redirects (301) and errors are not counted; a client that follows a redirect is counted at the new URL.
export function recordRead(env: Env, req: Request, path: string, status: number) {
  if (!env.READS || status !== 200 || req.method !== 'GET') return
  const p = path.replace(/\/+$/, '') || '/'
  if (!COUNTED.test(p)) return
  const { cls, agent } = classifyAgent(req.headers.get('User-Agent'))
  const country = (req.cf?.country as string | undefined) ?? 'XX'
  // blob order is the SQL column order: blob1 path, blob2 class, blob3 agent, blob4 country.
  // An index is capped at 96 bytes; it only keys sampling, the full path stays in blob1.
  env.READS.writeDataPoint({ indexes: [p.slice(0, 96)], blobs: [p, cls, agent, country], doubles: [1] })
}

const DATASET = 'site_reads'
// Bounds a day's row count so the copy fits in one small D1 statement and the Free plan's CPU budget.
const MAX_ROWS_PER_DAY = 2000

type Row = { path: string; cls: string; agent: string; country: string; n: number }

function parseRows(body: unknown): Row[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('analytics engine returned an unexpected shape')
  return data.map((r: Record<string, unknown>) => {
    const n = Math.round(Number(r.n))
    if (typeof r.path !== 'string' || typeof r.cls !== 'string' || typeof r.agent !== 'string' || typeof r.country !== 'string' || !Number.isFinite(n)) {
      throw new Error('analytics engine returned an unexpected row')
    }
    return { path: r.path, cls: r.cls, agent: r.agent, country: r.country, n }
  })
}

// Copies one UTC day of Analytics Engine events into D1. Re-running a day replaces its rows,
// so the nightly job re-copies the last few days and a missed run heals itself.
export async function rollupDay(env: Env, day: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!env.AE_API_TOKEN || !env.CF_ACCOUNT_ID) return 0
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day ${day}`)
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const sql = `SELECT blob1 AS path, blob2 AS cls, blob3 AS agent, blob4 AS country, SUM(_sample_interval) AS n
FROM ${DATASET}
WHERE timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${next} 00:00:00')
GROUP BY path, cls, agent, country
ORDER BY n DESC
LIMIT ${MAX_ROWS_PER_DAY}
FORMAT JSON`
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AE_API_TOKEN}` },
    body: sql,
  })
  if (!res.ok) throw new Error(`analytics engine query for ${day} failed: ${res.status} ${await res.text()}`)
  const rows = parseRows(await res.json())
  // One INSERT reads every row from a single JSON parameter, so the statement count does not grow with the day.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM read_daily WHERE day = ?').bind(day),
    env.DB.prepare(
      `INSERT INTO read_daily (day, path, client_class, agent, country, reads)
       SELECT ?1, value ->> '$.path', value ->> '$.cls', value ->> '$.agent', value ->> '$.country', value ->> '$.n'
       FROM json_each(?2)`,
    ).bind(day, JSON.stringify(rows)),
  ])
  return rows.length
}

// One failing day must not stop the others, yesterday above all: it is the day no earlier run has copied.
export async function rollupRecent(env: Env, now = new Date(), days = 3, fetchImpl: typeof fetch = fetch) {
  const failures: string[] = []
  for (let i = days; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    try {
      await rollupDay(env, d, fetchImpl)
    } catch (e) {
      failures.push(`${d}: ${(e as Error).message}`)
    }
  }
  if (failures.length) throw new Error(`read rollup failed for ${failures.length} day(s): ${failures.join('; ')}`)
}

export type StatsReport = {
  since: string
  byPath: { path: string; client_class: ClientClass; reads: number }[]
  byAgent: { client_class: ClientClass; agent: string; reads: number }[]
  byCountry: { country: string; client_class: ClientClass; reads: number }[]
}

export async function readStats(db: D1Database, since: string): Promise<StatsReport> {
  const [byPath, byAgent, byCountry] = await db.batch([
    db.prepare('SELECT path, client_class, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY path, client_class ORDER BY reads DESC LIMIT 1000').bind(since),
    db.prepare('SELECT client_class, agent, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY client_class, agent ORDER BY reads DESC LIMIT 50').bind(since),
    db.prepare('SELECT country, client_class, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY country, client_class ORDER BY reads DESC LIMIT 100').bind(since),
  ])
  return {
    since,
    byPath: byPath!.results as StatsReport['byPath'],
    byAgent: byAgent!.results as StatsReport['byAgent'],
    byCountry: byCountry!.results as StatsReport['byCountry'],
  }
}
