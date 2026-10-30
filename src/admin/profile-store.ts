// Write-side queries for the home page profile. Like posts, a save is one D1 batch (one transaction):
// the guard, the upsert and the revision row.
import type { ProfileInput } from './schema'
import { ConflictError, InputError } from './store'

type Lang = 'en' | 'tr'

const STALE = 'profile was changed elsewhere; reload before saving'
const GUARD = 'stale revision'

type ProfileRow = {
  name: string
  headline: string
  location: string
  links: string
  badges: string
  avatar_key: string | null
  body_md: string
  revision: number | null
}

// A language with no saved profile reads as an empty one, so the editor always has something to fill in.
export async function getProfileForEdit(db: D1Database, lang: Lang) {
  const row = await db
    .prepare(
      `SELECT name, headline, location, links, badges, avatar_key, body_md,
       (SELECT MAX(r.id) FROM profile_revisions r WHERE r.lang = profile.lang) AS revision
       FROM profile WHERE lang = ?`,
    )
    .bind(lang)
    .first<ProfileRow>()
  if (!row) {
    return { lang, name: '', headline: '', location: '', links: [], badges: [], avatar_key: null, body_md: '', revision: null }
  }
  return { ...row, lang, links: JSON.parse(row.links) as unknown, badges: JSON.parse(row.badges) as unknown }
}

function currentRevision(db: D1Database, lang: Lang): Promise<number | null> {
  return db
    .prepare('SELECT MAX(id) AS revision FROM profile_revisions WHERE lang = ?')
    .bind(lang)
    .first<{ revision: number | null }>()
    .then((r) => r?.revision ?? null)
}

// The key must be one of our own image uploads, so a profile cannot point /media/ at anything else.
async function requireImageAsset(db: D1Database, key: string | null) {
  if (key === null) return
  const row = await db.prepare("SELECT 1 AS ok FROM assets WHERE r2_key = ? AND content_type LIKE 'image/%'").bind(key).first()
  if (!row) throw new InputError('the profile photo is not an uploaded image')
}

export async function saveProfile(db: D1Database, lang: Lang, input: ProfileInput): Promise<{ revision: number }> {
  await requireImageAsset(db, input.avatar_key)
  if ((await currentRevision(db, lang)) !== input.base_revision) throw new ConflictError(STALE)
  const links = JSON.stringify(input.links)
  const badges = JSON.stringify(input.badges)
  const meta = { headline: input.headline, location: input.location, links: input.links, badges: input.badges, avatar_key: input.avatar_key }
  const stmts = [
    // The check above can race with another save; this repeats it inside the batch (json() of a non-JSON string aborts it).
    db
      .prepare(`SELECT json(CASE WHEN (SELECT MAX(id) FROM profile_revisions WHERE lang = ?) IS ? THEN '1' ELSE '${GUARD}' END)`)
      .bind(lang, input.base_revision),
    db
      .prepare(
        `INSERT INTO profile (lang, name, headline, location, links, badges, avatar_key, body_md, body_html, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT (lang) DO UPDATE SET name = excluded.name, headline = excluded.headline, location = excluded.location,
         links = excluded.links, badges = excluded.badges, avatar_key = excluded.avatar_key, body_md = excluded.body_md,
         body_html = excluded.body_html, updated_at = excluded.updated_at`,
      )
      .bind(lang, input.name, input.headline, input.location, links, badges, input.avatar_key, input.body_md, input.body_html),
    db
      .prepare('INSERT INTO profile_revisions (lang, name, body_md, meta_json, reason) VALUES (?, ?, ?, ?, ?)')
      .bind(lang, input.name, input.body_md, JSON.stringify(meta), input.reason),
    db.prepare('SELECT MAX(id) AS revision FROM profile_revisions WHERE lang = ?').bind(lang),
  ]
  let results: D1Result[]
  try {
    results = await db.batch(stmts)
  } catch (err) {
    if (err instanceof Error && err.message.includes('malformed JSON')) throw new ConflictError(STALE)
    throw err
  }
  const last = results[results.length - 1]?.results[0] as { revision: number } | undefined
  if (!last) throw new Error('saved profile could not be read back')
  return last
}

// name is returned as title so the panel's History component can show posts and the profile alike.
export async function listProfileRevisions(db: D1Database, lang: Lang) {
  const { results } = await db
    .prepare('SELECT id, name AS title, reason, created_at FROM profile_revisions WHERE lang = ? ORDER BY id DESC LIMIT 200')
    .bind(lang)
    .all()
  return results
}

export async function getProfileRevision(db: D1Database, lang: Lang, revId: number) {
  return db
    .prepare('SELECT id, name AS title, body_md, meta_json, reason, created_at FROM profile_revisions WHERE lang = ? AND id = ?')
    .bind(lang, revId)
    .first()
}
