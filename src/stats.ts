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

// A fixed list, because a free-form name from the User-Agent would let any client add rows.
const KNOWN_BOT = /ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|facebookexternalhit|linkedinbot|twitterbot|slackbot|discordbot|telegrambot|whatsapp|uptimerobot|headlesschrome|scrapy|curl|wget|python-requests|python-httpx|go-http-client|okhttp|node-fetch|axios/i

function botName(ua: string): string {
  return KNOWN_BOT.exec(ua)?.[0].toLowerCase() ?? 'other'
}

export function classifyAgent(ua: string | null | undefined): { cls: ClientClass; agent: string } {
  const s = ua ?? ''
  for (const [re, name] of AI) if (re.test(s)) return { cls: 'ai', agent: name }
  for (const [re, name] of SEARCH) if (re.test(s)) return { cls: 'search', agent: name }
  if (!s) return { cls: 'bot', agent: 'empty' }
  if (GENERIC_BOT.test(s) || !/Mozilla\//.test(s)) return { cls: 'bot', agent: botName(s) }
  return { cls: 'human', agent: 'browser' }
}

// Only canonical page and feed paths are counted, English at the root and Turkish under /tr.
// The path is the one Hono routed on (already percent-decoded), so /notes/%61bc and /notes/abc land on one row instead of inventing new ones.
const SLUGGED = '[a-z0-9-]{1,120}'
const COUNTED = new RegExp(
  `^(?:/(?:tr)?|(?:/tr)?/(?:notes|writing|projects|about|awards|(?:notes|writing|projects|tags)/${SLUGGED}|rss\\.xml)|/(?:sitemap\\.xml|llms\\.txt|robots\\.txt))$`,
)

const MACHINE_FILE = /^(?:\/tr)?\/rss\.xml$|^\/(?:robots\.txt|llms\.txt|sitemap\.xml)$/

// Set by the admin API on the owner's browser, so the owner's own reads are left out.
export const OWNER_COOKIE = 'site_owner'

const LABEL = /^[a-z0-9._-]{1,40}$/

function label(raw: string | null): string {
  const value = raw?.trim().toLowerCase() ?? ''
  return LABEL.test(value) ? value : ''
}

// utm_source wins over the Referer, since apps often send no Referer or a shortener's.
function readSource(req: Request): { source: string; campaign: string } {
  const url = new URL(req.url)
  const campaign = label(url.searchParams.get('utm_campaign'))
  const utm = label(url.searchParams.get('utm_source'))
  if (utm) return { source: utm, campaign }
  let host = ''
  try {
    host = new URL(req.headers.get('Referer') ?? '').hostname.replace(/^www\./, '')
  } catch {
    // No Referer, or not a URL.
  }
  return { source: host && host !== url.hostname.replace(/^www\./, '') ? label(host) || 'other' : 'direct', campaign }
}

// One value per person per day. The day is part of the hash and the key is a Worker secret,
// so a visitor cannot be followed from one day to the next, and no IP is stored.
async function visitorHash(env: Env, req: Request, day: string): Promise<string> {
  if (!env.AE_API_TOKEN) return ''
  const input = `visitor|${env.AE_API_TOKEN}|${day}|${req.headers.get('CF-Connecting-IP') ?? ''}|${req.headers.get('User-Agent') ?? ''}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Redirects (301) and errors are not counted; a client that follows a redirect is counted at the new URL.
export async function recordRead(env: Env, req: Request, path: string, status: number, now = new Date()) {
  if (!env.READS || status !== 200 || req.method !== 'GET') return
  if (new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=1(?:;|$)`).test(req.headers.get('Cookie') ?? '')) return
  const p = path.replace(/\/+$/, '') || '/'
  if (!COUNTED.test(p)) return
  const classified = classifyAgent(req.headers.get('User-Agent'))
  // People do not read these, so a browser User-Agent here is a program dressed as one.
  const { cls, agent } = classified.cls === 'human' && MACHINE_FILE.test(p) ? { cls: 'bot' as const, agent: 'browser-ua' } : classified
  const country = (req.cf?.country as string | undefined) ?? 'XX'
  // Source and visitor are for people only, so a crawler cannot fill the sources table.
  const human = cls === 'human'
  const { source, campaign } = human ? readSource(req) : { source: '', campaign: '' }
  const visitor = human ? await visitorHash(env, req, now.toISOString().slice(0, 10)) : ''
  // blob order is the SQL column order: blob1 path, blob2 class, blob3 agent, blob4 country,
  // blob5 source, blob6 campaign, blob7 visitor.
  // An index is capped at 96 bytes; it only keys sampling, the full path stays in blob1.
  env.READS.writeDataPoint({ indexes: [p.slice(0, 96)], blobs: [p, cls, agent, country, source, campaign, visitor], doubles: [1] })
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

type SourceRow = { source: string; campaign: string; n: number; v: number }

function count(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) throw new Error('analytics engine returned an unexpected count')
  return n
}

// Copies one UTC day of Analytics Engine events into D1. Re-running a day replaces its rows,
// so the nightly job re-copies the last few days and a missed run heals itself.
export async function rollupDay(env: Env, day: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!env.AE_API_TOKEN || !env.CF_ACCOUNT_ID) return 0
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day ${day}`)
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const inDay = `timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${next} 00:00:00')`
  const sql = `SELECT blob1 AS path, blob2 AS cls, blob3 AS agent, blob4 AS country, SUM(_sample_interval) AS n
FROM ${DATASET}
WHERE ${inDay}
GROUP BY path, cls, agent, country
ORDER BY n DESC
LIMIT ${MAX_ROWS_PER_DAY}
FORMAT JSON`
  const query = async (body: string): Promise<unknown> => {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AE_API_TOKEN}` },
      body,
    })
    if (!res.ok) throw new Error(`analytics engine query for ${day} failed: ${res.status} ${await res.text()}`)
    return res.json()
  }
  const rows = parseRows(await query(sql))
  const sourceBody = (await query(`SELECT blob5 AS source, blob6 AS campaign, SUM(_sample_interval) AS n, count(DISTINCT blob7) AS v
FROM ${DATASET}
WHERE ${inDay} AND blob2 = 'human' AND blob5 != ''
GROUP BY source, campaign
ORDER BY n DESC
LIMIT 500
FORMAT JSON`)) as { data?: Record<string, unknown>[] } | null
  const sources: SourceRow[] = (sourceBody?.data ?? []).map((r) => ({ source: String(r.source), campaign: String(r.campaign), n: count(r.n), v: count(r.v) }))
  const totalBody = (await query(`SELECT SUM(_sample_interval) AS n, count(DISTINCT blob7) AS v
FROM ${DATASET}
WHERE ${inDay} AND blob2 = 'human' AND blob7 != ''
FORMAT JSON`)) as { data?: Record<string, unknown>[] } | null
  const total = totalBody?.data?.[0]
  const visitors = count(total?.v ?? 0)
  // One INSERT reads every row from a single JSON parameter, so the statement count does not grow with the day.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM read_daily WHERE day = ?').bind(day),
    env.DB.prepare(
      `INSERT INTO read_daily (day, path, client_class, agent, country, reads)
       SELECT ?1, value ->> '$.path', value ->> '$.cls', value ->> '$.agent', value ->> '$.country', value ->> '$.n'
       FROM json_each(?2)`,
    ).bind(day, JSON.stringify(rows)),
    env.DB.prepare('DELETE FROM source_daily WHERE day = ?').bind(day),
    env.DB.prepare(
      `INSERT INTO source_daily (day, source, campaign, visitors, reads)
       SELECT ?1, value ->> '$.source', value ->> '$.campaign', value ->> '$.v', value ->> '$.n'
       FROM json_each(?2)`,
    ).bind(day, JSON.stringify(sources)),
    env.DB.prepare('DELETE FROM visitors_daily WHERE day = ?').bind(day),
    ...(visitors > 0
      ? [env.DB.prepare('INSERT INTO visitors_daily (day, visitors, reads) VALUES (?, ?, ?)').bind(day, visitors, count(total?.n ?? 0))]
      : []),
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
  byDay: { day: string; client_class: ClientClass; reads: number }[]
  visitors: { day: string; visitors: number }[]
  sources: { source: string; campaign: string; reads: number; visitor_days: number }[]
}

export async function readStats(db: D1Database, since: string): Promise<StatsReport> {
  const [byPath, byAgent, byCountry, byDay, visitors, sources] = await db.batch([
    db.prepare('SELECT path, client_class, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY path, client_class ORDER BY reads DESC LIMIT 1000').bind(since),
    db.prepare('SELECT client_class, agent, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY client_class, agent ORDER BY reads DESC LIMIT 50').bind(since),
    db.prepare('SELECT country, client_class, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY country, client_class ORDER BY reads DESC LIMIT 100').bind(since),
    db.prepare('SELECT day, client_class, SUM(reads) AS reads FROM read_daily WHERE day >= ? GROUP BY day, client_class ORDER BY day').bind(since),
    db.prepare('SELECT day, visitors FROM visitors_daily WHERE day >= ? ORDER BY day').bind(since),
    db.prepare('SELECT source, campaign, SUM(reads) AS reads, SUM(visitors) AS visitor_days FROM source_daily WHERE day >= ? GROUP BY source, campaign ORDER BY reads DESC LIMIT 100').bind(since),
  ])
  return {
    since,
    byPath: byPath!.results as StatsReport['byPath'],
    byAgent: byAgent!.results as StatsReport['byAgent'],
    byCountry: byCountry!.results as StatsReport['byCountry'],
    byDay: byDay!.results as StatsReport['byDay'],
    visitors: visitors!.results as StatsReport['visitors'],
    sources: sources!.results as StatsReport['sources'],
  }
}
