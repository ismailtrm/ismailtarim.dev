// Write-side queries for awards and contributions. One row per item; links are a JSON column.
import { ConflictError } from './store'
import { nextStamp } from './project-store'
import type { AchievementInput } from './schema'

export type AdminAchievementSummary = {
  id: number
  kind: 'award' | 'contribution'
  title: string
  year: number
  sort_order: number
  visible: number
}

export async function listAllAchievements(db: D1Database): Promise<AdminAchievementSummary[]> {
  const { results } = await db
    .prepare('SELECT id, kind, title, year, sort_order, visible FROM achievements ORDER BY sort_order, year DESC, id')
    .all<AdminAchievementSummary>()
  return results
}

export async function getAchievementForEdit(db: D1Database, id: number) {
  const row = await db
    .prepare('SELECT id, kind, title, context, outcome, summary, year, links, sort_order, visible, updated_at FROM achievements WHERE id = ?')
    .bind(id)
    .first<AdminAchievementSummary & { context: string; outcome: string; summary: string; links: string; updated_at: string }>()
  if (!row) return null
  return { ...row, visible: row.visible === 1, links: JSON.parse(row.links) as { label: string; url: string }[] }
}

const STALE = 'entry was changed elsewhere; reload before saving'

export async function saveAchievement(db: D1Database, id: number | null, input: AchievementInput): Promise<{ id: number; updated_at: string }> {
  const stamp = nextStamp(input.base_updated_at)
  const values = [
    input.kind, input.title, input.context, input.outcome, input.summary, input.year,
    JSON.stringify(input.links), input.sort_order, input.visible ? 1 : 0, stamp,
  ]
  if (id === null) {
    const created = await db
      .prepare(
        `INSERT INTO achievements (kind, title, context, outcome, summary, year, links, sort_order, visible, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, updated_at`,
      )
      .bind(...values)
      .first<{ id: number; updated_at: string }>()
    if (!created) throw new Error('saved entry could not be read back')
    return created
  }
  // One statement, so the check and the write cannot be split by another save. A row deleted in the
  // meantime matches nothing either, and reads as a conflict too.
  const saved = await db
    .prepare(
      `UPDATE achievements SET kind = ?, title = ?, context = ?, outcome = ?, summary = ?, year = ?, links = ?,
       sort_order = ?, visible = ?, updated_at = ? WHERE id = ? AND updated_at IS ? RETURNING id, updated_at`,
    )
    .bind(...values, id, input.base_updated_at)
    .first<{ id: number; updated_at: string }>()
  if (!saved) throw new ConflictError(STALE)
  return saved
}

export async function deleteAchievement(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM achievements WHERE id = ?').bind(id).run()
  return res.meta.changes > 0
}
