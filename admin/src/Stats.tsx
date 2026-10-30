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

export function Stats() {
  const [days, setDays] = useState(30)
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
      </div>
      <p class="muted">
        Counted on the server and copied from Analytics Engine each night, so today is not in yet. Clients are classified by User-Agent, which a
        client can fake.
      </p>
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p>Loading stats...</p>}
      {report && report.byPath.length === 0 && <p>No reads recorded for this period yet.</p>}
      {report && report.byPath.length > 0 && (
        <>
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
