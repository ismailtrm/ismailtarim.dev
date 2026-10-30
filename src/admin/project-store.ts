// Write-side queries for projects. The project row and its whole link list are replaced in one D1 batch.
import { ConflictError, moveRedirects } from './store'
import type { ProjectInput } from './schema'

export type AdminProjectSummary = {
  id: number
  slug: string
  name: string
  year: number
  status: string
  sort_order: number
  visible: number
  featured: number
}

export async function listAllProjects(db: D1Database): Promise<AdminProjectSummary[]> {
  const { results } = await db
    .prepare('SELECT id, slug, name, year, status, sort_order, visible, featured FROM projects ORDER BY sort_order, year DESC')
    .all<AdminProjectSummary>()
  return results
}

export async function getProjectForEdit(db: D1Database, id: number) {
  const [project, links] = await db.batch([
    db.prepare(
      `SELECT id, slug, name, summary, year, status, case_md, case_html, sort_order, visible, featured, post_id, updated_at
       FROM projects WHERE id = ?`,
    ).bind(id),
    db.prepare('SELECT kind, label, url FROM project_links WHERE project_id = ? ORDER BY sort_order, id').bind(id),
  ])
  const row = project?.results[0] as Record<string, unknown> | undefined
  if (!row) return null
  return { ...row, visible: row.visible === 1, featured: row.featured === 1, links: links?.results ?? [] }
}

const STALE = 'project was changed elsewhere; reload before saving'
const GUARD = 'stale revision'

type ExistingProject = { slug: string; updated_at: string | null; has_case: number }

// The old case page URLs keep working after a slug change, in both language prefixes (like posts).
function slugRedirects(db: D1Database, oldSlug: string, newSlug: string): D1PreparedStatement[] {
  return ['', '/tr'].flatMap((pre) => moveRedirects(db, `${pre}/projects/${oldSlug}`, `${pre}/projects/${newSlug}`))
}

// A save must always change updated_at, or a stale copy saved in the same millisecond would still match.
export function nextStamp(prev: string | null): string {
  const now = new Date()
  return new Date(prev && now.toISOString() <= prev ? Date.parse(prev) + 1 : now.getTime()).toISOString()
}

export async function saveProject(db: D1Database, id: number | null, input: ProjectInput): Promise<{ id: number; updated_at: string }> {
  const stamp = nextStamp(input.base_updated_at)
  const values = [
    input.slug, input.name, input.summary, input.year, input.status, input.case_md, input.case_html,
    input.sort_order, input.visible ? 1 : 0, input.featured ? 1 : 0, input.post_id, stamp,
  ]
  const stmts: D1PreparedStatement[] = []
  let ref: { sql: string; binds: unknown[] }
  if (id === null) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO projects (slug, name, summary, year, status, case_md, case_html, sort_order, visible, featured, post_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...values),
    )
    ref = { sql: '(SELECT id FROM projects WHERE slug = ?)', binds: [input.slug] }
  } else {
    const existing = await db
      .prepare("SELECT slug, updated_at, COALESCE(TRIM(case_html) <> '', 0) AS has_case FROM projects WHERE id = ?")
      .bind(id)
      .first<ExistingProject>()
    if (!existing) throw new ConflictError('project no longer exists')
    if (existing.updated_at !== input.base_updated_at) throw new ConflictError(STALE)
    ref = { sql: '?', binds: [id] }
    stmts.push(
      // Repeats the check above inside the batch; json() of a non-JSON string aborts it. A project deleted
      // in the meantime fails the EXISTS part, so it reads as a conflict and not as a broken foreign key.
      db
        .prepare(
          `SELECT json(CASE WHEN EXISTS (SELECT 1 FROM projects WHERE id = ?) AND (SELECT updated_at FROM projects WHERE id = ?) IS ?
           THEN '1' ELSE '${GUARD}' END)`,
        )
        .bind(id, id, input.base_updated_at),
      db
        .prepare(
          `UPDATE projects SET slug = ?, name = ?, summary = ?, year = ?, status = ?, case_md = ?, case_html = ?,
           sort_order = ?, visible = ?, featured = ?, post_id = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(...values, id),
    )
    if (existing.has_case === 1 && existing.slug !== input.slug) stmts.push(...slugRedirects(db, existing.slug, input.slug))
  }
  stmts.push(db.prepare(`DELETE FROM project_links WHERE project_id = ${ref.sql}`).bind(...ref.binds))
  input.links.forEach((l, i) => {
    stmts.push(
      db
        .prepare(`INSERT INTO project_links (project_id, kind, label, url, sort_order) VALUES (${ref.sql}, ?, ?, ?, ?)`)
        .bind(...ref.binds, l.kind, l.label, l.url, i),
    )
  })
  stmts.push(db.prepare(`SELECT id, updated_at FROM projects WHERE id = ${ref.sql}`).bind(...ref.binds))
  let results: D1Result[]
  try {
    results = await db.batch(stmts)
  } catch (err) {
    if (err instanceof Error && err.message.includes('malformed JSON')) throw new ConflictError(STALE)
    throw err
  }
  const last = results[results.length - 1]?.results[0] as { id: number; updated_at: string } | undefined
  if (!last) throw new Error('saved project could not be read back')
  return last
}

export async function deleteProject(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  return res.meta.changes > 0
}
