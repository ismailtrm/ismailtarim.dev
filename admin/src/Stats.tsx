import { useEffect, useState } from 'preact/hooks'
import { api, type ClientClass, type Stats as Report } from './api'

const CLASSES: { key: ClientClass; label: string }[] = [
  { key: 'human', label: 'People' },
  { key: 'ai', label: 'AI crawlers' },
  { key: 'search', label: 'Search' },
  { key: 'bot', label: 'Other bots' },
]

// Rows of (key, class, reads) pivoted into one row per key with a column per class.
function pivot<R extends { client_class: ClientClass; reads: number }>(rows: R[], key: (r: R) => string) {
  const out = new Map<string, Record<ClientClass, number>>()
  for (const r of rows) {
    const row = out.get(key(r)) ?? { human: 0, ai: 0, search: 0, bot: 0 }
    row[r.client_class] += r.reads
    out.set(key(r), row)
  }
  return [...out.entries()].sort((a, b) => total(b[1]) - total(a[1]))
}

const total = (r: Record<ClientClass, number>) => r.human + r.ai + r.search + r.bot

function Pivot({ caption, first, rows }: { caption: string; first: string; rows: [string, Record<ClientClass, number>][] }) {
  return (
    <table class="post-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{first}</th>
          {CLASSES.map((c) => (
            <th scope="col" key={c.key}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, r]) => (
          <tr key={k}>
            <td>{k}</td>
            {CLASSES.map((c) => (
              <td key={c.key}>{r[c.key] || ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const DAY_MS = 86_400_000

// Every day between the first and last point, so a quiet day shows as a gap and not as nothing at all.
function fillDays(points: Map<string, number>): [string, number][] {
  const keys = [...points.keys()].sort()
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (!first || !last) return []
  const out: [string, number][] = []
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    out.push([day, points.get(day) ?? 0])
  }
  return out
}

// Weeks start on Monday and are named by that Monday.
function byWeek(days: [string, number][]): [string, number][] {
  const weeks = new Map<string, number>()
  for (const [day, n] of days) {
    const t = Date.parse(`${day}T00:00:00Z`)
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
    weeks.set(monday, (weeks.get(monday) ?? 0) + n)
  }
  return [...weeks.entries()]
}

function BarChart({ title, points }: { title: string; points: [string, number][] }) {
  const width = 600
  const height = 120
  const gap = 2
  const max = Math.max(1, ...points.map(([, n]) => n))
  // Bars fill the width, so the dates under the first and last bar sit under them.
  const barWidth = Math.max(1, width / Math.max(points.length, 1) - gap)
  return (
    <figure class="stat-chart">
      <figcaption>
        {title}, highest {max}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <line class="stat-axis" x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} />
        {points.map(([label, n], i) => {
          const h = n === 0 ? 0 : Math.max(2, (n / max) * (height - 4))
          return (
            <rect key={label} class="stat-bar" x={i * (barWidth + gap)} y={height - 1 - h} width={barWidth} height={h} rx="2">
              <title>{`${label}: ${n}`}</title>
            </rect>
          )
        })}
      </svg>
      {points.length > 0 && (
        <div class="stat-range muted">
          <span>{points[0]?.[0]}</span>
          <span>{points[points.length - 1]?.[0]}</span>
        </div>
      )}
    </figure>
  )
}

function LinkBuilder() {
  const [path, setPath] = useState('/')
  const [source, setSource] = useState('linkedin')
  const [campaign, setCampaign] = useState('')
  const [copied, setCopied] = useState(false)
  let link = ''
  try {
    const url = new URL(path.trim() || '/', location.origin)
    if (url.origin === location.origin) {
      if (source.trim()) url.searchParams.set('utm_source', source.trim().toLowerCase())
      if (campaign.trim()) url.searchParams.set('utm_campaign', campaign.trim().toLowerCase())
      link = url.toString()
    }
  } catch {
    // Not a usable path yet; the output stays empty while typing.
  }
  return (
    <fieldset class="link-builder">
      <legend>Link with a source</legend>
      <label>
        Path <input value={path} onInput={(e) => setPath(e.currentTarget.value)} />
      </label>
      <label>
        Source <input value={source} onInput={(e) => setSource(e.currentTarget.value)} />
      </label>
      <label>
        Campaign <input value={campaign} onInput={(e) => setCampaign(e.currentTarget.value)} />
      </label>
      <label>
        Link <input readOnly value={link} />
      </label>
      <button
        type="button"
        disabled={!link}
        onClick={() => {
          void navigator.clipboard.writeText(link).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </fieldset>
  )
}

export function Stats() {
  const [days, setDays] = useState(30)
  const [weekly, setWeekly] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    // A slower reply for an earlier period must not overwrite the one asked for last.
    let current = true
    setReport(null)
    setError('')
    api.stats(days).then(
      (r) => current && setReport(r),
      (e: Error) => current && setError(e.message),
    )
    return () => {
      current = false
    }
  }, [days])

  return (
    <section>
      <div class="list-actions">
        <label>
          Period{' '}
          <select value={days} onChange={(e) => setDays(Number(e.currentTarget.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={365}>Last year</option>
            <option value={3650}>All time</option>
          </select>
        </label>
        <label>
          Charts{' '}
          <select value={weekly ? 'week' : 'day'} onChange={(e) => setWeekly(e.currentTarget.value === 'week')}>
            <option value="day">By day</option>
            <option value="week">By week</option>
          </select>
        </label>
      </div>
      <p class="muted">
        Counted on the server and copied from Analytics Engine each night, so today is not in yet. Clients are classified by User-Agent, which a
        client can fake.
      </p>
      <p class="muted">
        Visitors are counted per day without cookies or stored IPs. Someone who returns on another day counts again, so
        weekly and period totals are visitor-days, not people. Your own browser is left out once you open this panel.
      </p>
      <LinkBuilder />
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p>Loading stats...</p>}
      {report && report.byPath.length === 0 && <p>No reads recorded for this period yet.</p>}
      {report && report.byPath.length > 0 && (
        <>
          <BarChart
            title={weekly ? 'Visitor-days by week' : 'Visitors by day'}
            points={(weekly ? byWeek : (d: [string, number][]) => d)(fillDays(new Map(report.visitors.map((v) => [v.day, v.visitors]))))}
          />
          <BarChart
            title={weekly ? 'Reads by people, by week' : 'Reads by people, by day'}
            points={(weekly ? byWeek : (d: [string, number][]) => d)(
              fillDays(new Map(report.byDay.filter((r) => r.client_class === 'human').map((r) => [r.day, r.reads]))),
            )}
          />
          <table class="post-table">
            <caption>Sources (people)</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Campaign</th>
                <th scope="col">Reads</th>
                <th scope="col">Visitor-days</th>
              </tr>
            </thead>
            <tbody>
              {report.sources.map((s) => (
                <tr key={`${s.source}:${s.campaign}`}>
                  <td>{s.source}</td>
                  <td>{s.campaign}</td>
                  <td>{s.reads}</td>
                  <td>{s.visitor_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pivot caption="Reads by page" first="Page" rows={pivot(report.byPath, (r) => r.path)} />
          <table class="post-table">
            <caption>Reads by agent</caption>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Class</th>
                <th scope="col">Reads</th>
              </tr>
            </thead>
            <tbody>
              {report.byAgent.map((a) => (
                <tr key={`${a.client_class}:${a.agent}`}>
                  <td>{a.agent}</td>
                  <td>{CLASSES.find((c) => c.key === a.client_class)?.label}</td>
                  <td>{a.reads}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pivot caption="Reads by country" first="Country" rows={pivot(report.byCountry, (r) => r.country)} />
        </>
      )}
    </section>
  )
}
