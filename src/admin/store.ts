// Write-side queries for the admin panel. Every save writes the post, its tags, its note box
// and one revision row in a single D1 batch, which runs as one transaction.
import { postPath } from '../format'
import { tagSlug, type PostInput } from './schema'

export type AdminPostSummary = {
  id: number
  kind: 'writing' | 'note'
  slug: string
  title: string
  lang: 'en' | 'tr'
  status: string
  published_at: string | null
  updated_at: string
}

type ExistingPost = { id: number; kind: 'writing' | 'note'; slug: string; lang: 'en' | 'tr'; status: string; revision: number | null }

export class ConflictError extends Error {}
export class InputError extends Error {}

const STALE = 'post was changed elsewhere; reload before saving'
const GUARD = 'stale revision'

export async function listAllPosts(db: D1Database): Promise<AdminPostSummary[]> {
  const { results } = await db
    .prepare('SELECT id, kind, slug, title, lang, status, published_at, updated_at FROM posts ORDER BY updated_at DESC')
    .all<AdminPostSummary>()
  return results
}

export async function getPostForEdit(db: D1Database, id: number) {
  const post = await db
    .prepare(
      `SELECT id, kind, slug, title, summary, lang, status, published_at, body_md, updated_at,
       (SELECT MAX(r.id) FROM revisions r WHERE r.post_id = posts.id) AS revision
       FROM posts WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
  if (!post) return null
  const [tags, note] = await db.batch([
    db.prepare('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name').bind(id),
    db.prepare('SELECT symptom, fix, environment, verified_at FROM note_meta WHERE post_id = ?').bind(id),
  ])
  const noteRow = note?.results[0] as { environment: string } | undefined
  return {
    ...post,
    tags: (tags?.results as { name: string }[]).map((t) => t.name),
    note: noteRow ? { ...noteRow, environment: JSON.parse(noteRow.environment) as unknown } : null,
  }
}

// Old paths keep working: the old path now points at the new one, earlier redirects into the old path
// are retargeted instead of chained, and a redirect still sitting on the new path is dropped.
export function moveRedirects(db: D1Database, oldPath: string, newPath: string): D1PreparedStatement[] {
  return [
    db.prepare('INSERT INTO redirects (from_path, to_path) VALUES (?, ?) ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path').bind(oldPath, newPath),
    db.prepare('UPDATE redirects SET to_path = ? WHERE to_path = ? AND from_path <> ?').bind(newPath, oldPath, newPath),
    db.prepare('DELETE FROM redirects WHERE from_path = ?').bind(newPath),
  ]
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export async function savePost(db: D1Database, id: number | null, input: PostInput): Promise<{ id: number; revision: number; published_at: string | null }> {
  const publishedAt = input.status === 'published' ? (input.published_at ?? nowIso()) : input.published_at
  const stmts: D1PreparedStatement[] = []
  // Every statement names the post through this reference, so a new post's id can be used
  // inside the same batch and the whole save stays one transaction.
  let ref: { sql: string; binds: unknown[] }

  if (id === null) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO posts (kind, slug, title, summary, lang, status, body_md, body_html, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(input.kind, input.slug, input.title, input.summary, input.lang, input.status, input.body_md, input.body_html, publishedAt),
    )
    ref = { sql: '(SELECT id FROM posts WHERE kind = ? AND lang = ? AND slug = ?)', binds: [input.kind, input.lang, input.slug] }
  } else {
    const existing = await db
      .prepare('SELECT id, kind, slug, lang, status, (SELECT MAX(r.id) FROM revisions r WHERE r.post_id = posts.id) AS revision FROM posts WHERE id = ?')
      .bind(id)
      .first<ExistingPost>()
    if (!existing) throw new ConflictError('post no longer exists')
    if (existing.revision !== input.base_revision) throw new ConflictError(STALE)
    ref = { sql: '?', binds: [id] }

    // The check above can race with another save. This guard repeats it inside the batch:
    // json() on a non-JSON string raises an error, and an error rolls the whole batch back.
    stmts.push(
      db
        .prepare(`SELECT json(CASE WHEN (SELECT MAX(id) FROM revisions WHERE post_id = ?) IS ? THEN '1' ELSE '${GUARD}' END)`)
        .bind(id, input.base_revision),
      db
        .prepare(
          `UPDATE posts SET kind = ?, slug = ?, title = ?, summary = ?, lang = ?, status = ?, body_md = ?, body_html = ?,
           published_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(input.kind, input.slug, input.title, input.summary, input.lang, input.status, input.body_md, input.body_html, publishedAt, nowIso(), id),
    )
    // The path carries the /tr prefix, so changing the language moves the post like a slug change does.
    const oldPath = postPath(existing.kind, existing.slug, existing.lang)
    const newPath = postPath(input.kind, input.slug, input.lang)
    if (oldPath !== newPath && existing.status === 'published') stmts.push(...moveRedirects(db, oldPath, newPath))

    // A live post that keeps its language and kind but changes slug takes its translation along, so the pair stays linked.
    // A draft (for example a fresh translation) renaming itself must not drag a published original with it.
    if (existing.status === 'published' && input.kind === existing.kind && input.lang === existing.lang && input.slug !== existing.slug) {
      const sibling = await db
        .prepare('SELECT id, lang, status FROM posts WHERE kind = ? AND slug = ? AND lang <> ?')
        .bind(existing.kind, existing.slug, existing.lang)
        .first<{ id: number; lang: 'en' | 'tr'; status: string }>()
      if (sibling) {
        stmts.push(
          db.prepare('UPDATE posts SET slug = ? WHERE id = ?').bind(input.slug, sibling.id),
          // A revision makes an editor still open on the sibling conflict instead of saving the old slug back.
          db
            .prepare(
              `INSERT INTO revisions (post_id, title, body_md, meta_json, reason)
               SELECT id, title, body_md, json_object('kind', kind, 'slug', slug, 'summary', summary, 'lang', lang, 'status', status), 'save'
               FROM posts WHERE id = ?`,
            )
            .bind(sibling.id),
        )
        if (sibling.status === 'published') {
          stmts.push(...moveRedirects(db, postPath(existing.kind, existing.slug, sibling.lang), postPath(existing.kind, input.slug, sibling.lang)))
        }
      }
    }
  }

  // A redirect left on a path that is live again would come back to life when the post is unpublished.
  if (input.status === 'published') {
    stmts.push(db.prepare('DELETE FROM redirects WHERE from_path = ?').bind(postPath(input.kind, input.slug, input.lang)))
  }

  stmts.push(db.prepare(`DELETE FROM post_tags WHERE post_id = ${ref.sql}`).bind(...ref.binds))
  for (const name of input.tags) {
    const s = tagSlug(name)
    stmts.push(
      // The first spelling of a tag wins; a later post cannot rename it for every other post.
      db.prepare('INSERT INTO tags (slug, name) VALUES (?, ?) ON CONFLICT (slug) DO NOTHING').bind(s, name),
      db.prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT ${ref.sql}, id FROM tags WHERE slug = ?`).bind(...ref.binds, s),
    )
  }

  if (input.note) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO note_meta (post_id, symptom, fix, environment, verified_at) VALUES (${ref.sql}, ?, ?, ?, ?)
           ON CONFLICT (post_id) DO UPDATE SET symptom = excluded.symptom, fix = excluded.fix,
           environment = excluded.environment, verified_at = excluded.verified_at`,
        )
        .bind(...ref.binds, input.note.symptom, input.note.fix, JSON.stringify(input.note.environment), input.note.verified_at),
    )
  } else {
    stmts.push(db.prepare(`DELETE FROM note_meta WHERE post_id = ${ref.sql}`).bind(...ref.binds))
  }

  const meta = { kind: input.kind, slug: input.slug, summary: input.summary, lang: input.lang, status: input.status, tags: input.tags, note: input.note }
  stmts.push(
    db
      .prepare(`INSERT INTO revisions (post_id, title, body_md, meta_json, reason) VALUES (${ref.sql}, ?, ?, ?, ?)`)
      .bind(...ref.binds, input.title, input.body_md, JSON.stringify(meta), input.reason),
    db
      .prepare(`SELECT p.id, p.published_at, (SELECT MAX(r.id) FROM revisions r WHERE r.post_id = p.id) AS revision FROM posts p WHERE p.id = ${ref.sql}`)
      .bind(...ref.binds),
  )

  let results: D1Result[]
  try {
    results = await db.batch(stmts)
  } catch (err) {
    if (err instanceof Error && err.message.includes('malformed JSON')) throw new ConflictError(STALE)
    throw err
  }
  const last = results[results.length - 1]?.results[0] as { id: number; revision: number; published_at: string | null } | undefined
  if (!last) throw new Error('saved post could not be read back')
  return last
}

export async function listRevisions(db: D1Database, postId: number) {
  const { results } = await db
    .prepare('SELECT id, title, reason, created_at FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 200')
    .bind(postId)
    .all()
  return results
}

export async function getRevision(db: D1Database, postId: number, revId: number) {
  return db
    .prepare('SELECT id, title, body_md, meta_json, reason, created_at FROM revisions WHERE post_id = ? AND id = ?')
    .bind(postId, revId)
    .first()
}
