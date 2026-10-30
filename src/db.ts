// Read-side queries. List queries never select body_html/body_md: those are the wide columns.

export type Kind = 'writing' | 'note'
export type Lang = 'en' | 'tr'

export type PostListItem = {
  kind: Kind
  slug: string
  title: string
  summary: string | null
  lang: Lang
  published_at: string
}

export type Tag = { slug: string; name: string }

type NoteMeta = {
  symptom: string
  fix: string
  environment: Record<string, string>
  verified_at: string
}

export type Post = PostListItem & {
  id: number
  body_html: string
  og_key: string | null
  updated_at: string
  tags: Tag[]
  note: NoteMeta | null
}

export type ProjectStatus = 'merged' | 'under_review' | 'submitted' | 'published' | 'personal'

type ProjectLink = { kind: string; label: string; url: string }

export type Project = {
  id: number
  slug: string
  name: string
  summary: string
  year: number
  status: ProjectStatus
  status_label: string | null
  has_case: boolean
  links: ProjectLink[]
  results: ProjectResult[]
}

// A visible award or contribution that belongs to this project; the page links it to its entry on /awards.
export type ProjectResult = { id: number; title: string; outcome: string }

const LIST_COLUMNS = 'kind, slug, title, summary, lang, published_at'

// Row shapes are asserted, not checked: keep the SELECT lists and these types in step.
function rows<T>(res: D1Result | undefined): T[] {
  if (!res) throw new Error('D1 batch returned fewer results than statements')
  return res.results as T[]
}

// Which kinds of post exist in this language; an empty section stays out of the menu.
export async function publishedKinds(db: D1Database, lang: Lang): Promise<Kind[]> {
  const { results } = await db.prepare("SELECT DISTINCT kind FROM posts WHERE status = 'published' AND lang = ?").bind(lang).all<{ kind: Kind }>()
  return results.map((r) => r.kind)
}

export async function listPublished(db: D1Database, lang: Lang, kind: Kind | null, limit = 50): Promise<PostListItem[]> {
  const stmt = kind
    ? db
        .prepare(`SELECT ${LIST_COLUMNS} FROM posts WHERE status = 'published' AND lang = ? AND kind = ? ORDER BY published_at DESC LIMIT ?`)
        .bind(lang, kind, limit)
    : db
        .prepare(`SELECT ${LIST_COLUMNS} FROM posts WHERE status = 'published' AND lang = ? ORDER BY published_at DESC LIMIT ?`)
        .bind(lang, limit)
  const { results } = await stmt.all<PostListItem>()
  return results
}

export async function listByTag(db: D1Database, lang: Lang, tagSlug: string): Promise<{ tag: Tag; posts: PostListItem[] } | null> {
  const [tagRes, postsRes] = await db.batch([
    db.prepare('SELECT slug, name FROM tags WHERE slug = ?').bind(tagSlug),
    db
      .prepare(
        `SELECT p.kind, p.slug, p.title, p.summary, p.lang, p.published_at
         FROM posts p JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id
         WHERE t.slug = ? AND p.status = 'published' AND p.lang = ?
         ORDER BY p.published_at DESC LIMIT 500`,
      )
      .bind(tagSlug, lang),
  ])
  const tag = rows<Tag>(tagRes)[0]
  // A tag with nothing published in this language has no page in it.
  if (!tag || !rows<PostListItem>(postsRes).length) return null
  return { tag, posts: rows<PostListItem>(postsRes) }
}

type PostRow = PostListItem & { id: number; body_html: string; og_key: string | null; updated_at: string }
type NoteRow = { symptom: string; fix: string; environment: string; verified_at: string }

export async function getPublishedPost(db: D1Database, lang: Lang, kind: Kind, slug: string): Promise<Post | null> {
  const row = await db
    .prepare(
      `SELECT id, ${LIST_COLUMNS}, body_html, og_key, updated_at FROM posts
       WHERE kind = ? AND lang = ? AND slug = ? AND status = 'published'`,
    )
    .bind(kind, lang, slug)
    .first<PostRow>()
  if (!row) return null

  const [tagsRes, noteRes] = await db.batch([
    db
      .prepare('SELECT t.slug, t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name')
      .bind(row.id),
    db.prepare('SELECT symptom, fix, environment, verified_at FROM note_meta WHERE post_id = ?').bind(row.id),
  ])
  const noteRow = rows<NoteRow>(noteRes)[0]
  return {
    ...row,
    tags: rows<Tag>(tagsRes),
    note: noteRow ? { ...noteRow, environment: parseEnvironment(noteRow.environment) } : null,
  }
}

// The languages in which this slug is published, for hreflang and the language switch.
export async function listTranslations(db: D1Database, kind: Kind, slug: string): Promise<Lang[]> {
  const { results } = await db
    .prepare("SELECT lang FROM posts WHERE kind = ? AND slug = ? AND status = 'published' ORDER BY lang")
    .bind(kind, slug)
    .all<{ lang: Lang }>()
  return results.map((r) => r.lang)
}

// environment is checked with json_valid() in the schema; this only narrows the shape.
function parseEnvironment(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
}

type ProjectRow = Omit<Project, 'links' | 'has_case' | 'results'> & { has_case: number }
type LinkRow = ProjectLink & { project_id: number }

function groupLinks(linkRows: LinkRow[]): Map<number, ProjectLink[]> {
  const links = new Map<number, ProjectLink[]>()
  for (const l of linkRows) {
    const list = links.get(l.project_id) ?? []
    list.push({ kind: l.kind, label: l.label, url: l.url })
    links.set(l.project_id, list)
  }
  return links
}

type ResultRow = ProjectResult & { project_id: number }

function resultsQuery(db: D1Database): D1PreparedStatement {
  return db.prepare(
    'SELECT id, project_id, title, outcome FROM achievements WHERE visible = 1 AND project_id IS NOT NULL ORDER BY sort_order, year DESC, id',
  )
}

function groupResults(resultRows: ResultRow[]): Map<number, ProjectResult[]> {
  const results = new Map<number, ProjectResult[]>()
  for (const { project_id, ...r } of resultRows) results.set(project_id, [...(results.get(project_id) ?? []), r])
  return results
}

export async function listProjects(db: D1Database): Promise<Project[]> {
  const [projectsRes, linksRes, resultsRes] = await db.batch([
    db.prepare(
      `SELECT id, slug, name, summary, year, status, status_label, COALESCE(TRIM(case_html) <> '', 0) AS has_case
       FROM projects WHERE visible = 1 ORDER BY sort_order, year DESC`,
    ),
    db.prepare(
      `SELECT l.project_id, l.kind, l.label, l.url FROM project_links l
       JOIN projects p ON p.id = l.project_id WHERE p.visible = 1 ORDER BY l.project_id, l.sort_order`,
    ),
    resultsQuery(db),
  ])
  const links = groupLinks(rows<LinkRow>(linksRes))
  const results = groupResults(rows<ResultRow>(resultsRes))
  return rows<ProjectRow>(projectsRes).map((p) => ({
    ...p,
    has_case: p.has_case === 1,
    links: links.get(p.id) ?? [],
    results: results.get(p.id) ?? [],
  }))
}

export type Achievement = {
  id: number
  kind: 'award' | 'contribution'
  title: string
  context: string
  outcome: string
  summary: string
  year: number
  links: { label: string; url: string }[]
  // Set only while the project has a public case page to link to.
  project: { slug: string; name: string } | null
}

type AchievementRow = Omit<Achievement, 'links' | 'project'> & { links: string; project_slug: string | null; project_name: string | null }

const ACHIEVEMENT_SELECT = `SELECT a.id, a.kind, a.title, a.context, a.outcome, a.summary, a.year, a.links, p.slug AS project_slug, p.name AS project_name
       FROM achievements a LEFT JOIN projects p ON p.id = a.project_id AND p.visible = 1 AND TRIM(p.case_html) <> ''`

// links is checked with json_valid() in the schema; this only narrows the shape.
function toAchievement({ project_slug, project_name, links, ...r }: AchievementRow): Achievement {
  const parsed: unknown = JSON.parse(links)
  return {
    ...r,
    links: Array.isArray(parsed)
      ? parsed.filter((l): l is { label: string; url: string } => typeof l?.label === 'string' && typeof l?.url === 'string')
      : [],
    project: project_slug && project_name ? { slug: project_slug, name: project_name } : null,
  }
}

export async function listAchievements(db: D1Database): Promise<Achievement[]> {
  const { results } = await db
    .prepare(`${ACHIEVEMENT_SELECT} WHERE a.visible = 1 ORDER BY a.sort_order, a.year DESC, a.id`)
    .all<AchievementRow>()
  return results.map(toAchievement)
}

// The published post a project points at; an unpublished one is dropped in SQL, so nothing about it reaches the page.
export type FeaturedProject = Project & { post: { kind: Kind; slug: string; lang: Lang } | null }

type FeaturedRow = ProjectRow & { post_kind: Kind | null; post_slug: string | null; post_lang: Lang | null }

export async function listFeaturedProjects(db: D1Database): Promise<FeaturedProject[]> {
  const [projectsRes, linksRes, resultsRes] = await db.batch([
    db.prepare(
      `SELECT p.id, p.slug, p.name, p.summary, p.year, p.status, p.status_label, COALESCE(TRIM(p.case_html) <> '', 0) AS has_case,
       po.kind AS post_kind, po.slug AS post_slug, po.lang AS post_lang
       FROM projects p LEFT JOIN posts po ON po.id = p.post_id AND po.status = 'published'
       WHERE p.visible = 1 AND p.featured = 1 ORDER BY p.sort_order, p.year DESC`,
    ),
    db.prepare(
      `SELECT l.project_id, l.kind, l.label, l.url FROM project_links l
       JOIN projects p ON p.id = l.project_id WHERE p.visible = 1 AND p.featured = 1 ORDER BY l.project_id, l.sort_order`,
    ),
    resultsQuery(db),
  ])
  const links = groupLinks(rows<LinkRow>(linksRes))
  const results = groupResults(rows<ResultRow>(resultsRes))
  return rows<FeaturedRow>(projectsRes).map(({ post_kind, post_slug, post_lang, ...p }) => ({
    ...p,
    has_case: p.has_case === 1,
    links: links.get(p.id) ?? [],
    results: results.get(p.id) ?? [],
    post: post_kind && post_slug && post_lang ? { kind: post_kind, slug: post_slug, lang: post_lang } : null,
  }))
}

export type ProfileLink = { label: string; url: string }

export type HomeProfile = {
  lang: Lang
  name: string
  headline: string
  location: string
  links: ProfileLink[]
  badges: ProfileLink[]
  avatar: { key: string; width: number; height: number } | null
  body_html: string
}

type ProfileRow = Omit<HomeProfile, 'links' | 'badges' | 'avatar'> & {
  links: string
  badges: string
  avatar_key: string | null
  avatar_width: number | null
  avatar_height: number | null
}

// Only profiles with a body count: a row with empty body_html is a draft of the home page, never rendered.
export async function listHomeProfiles(db: D1Database): Promise<Partial<Record<Lang, HomeProfile>>> {
  const { results } = await db
    .prepare(
      `SELECT p.lang, p.name, p.headline, p.location, p.links, p.badges, p.avatar_key, p.body_html,
       a.width AS avatar_width, a.height AS avatar_height
       FROM profile p LEFT JOIN assets a ON a.r2_key = p.avatar_key
       WHERE TRIM(p.body_html) <> ''`,
    )
    .all<ProfileRow>()
  return Object.fromEntries(
    results.map(({ links, badges, avatar_key, avatar_width, avatar_height, ...p }) => [
      p.lang,
      {
        ...p,
        links: parseLinkList(links),
        badges: parseLinkList(badges),
        avatar: avatar_key ? { key: avatar_key, width: avatar_width ?? 256, height: avatar_height ?? 256 } : null,
      },
    ]),
  )
}

// The JSON is checked by json_valid() and written by the panel; this only narrows the shape.
function parseLinkList(raw: string): ProfileLink[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (l): l is ProfileLink => !!l && typeof l === 'object' && typeof l.label === 'string' && typeof l.url === 'string',
  )
}

export type ProjectCase = {
  name: string
  summary: string
  case_html: string
  og_key: string | null
  year: number
  status: ProjectStatus
  status_label: string | null
  role: string
  team: string
  links: ProjectLink[]
  achievements: Achievement[]
  post: (Pick<PostListItem, 'kind' | 'slug' | 'lang' | 'title' | 'published_at'>) | null
}

type CaseRow = Omit<ProjectCase, 'links' | 'achievements' | 'post'> & {
  id: number
  post_kind: Kind | null
  post_slug: string | null
  post_lang: Lang | null
  post_title: string | null
  post_published_at: string | null
}

export async function getProjectCase(db: D1Database, slug: string): Promise<ProjectCase | null> {
  const [projectRes, linksRes, achievementsRes] = await db.batch([
    db
      .prepare(
        `SELECT p.id, p.name, p.summary, p.case_html, p.og_key, p.year, p.status, p.status_label, p.role, p.team,
         po.kind AS post_kind, po.slug AS post_slug, po.lang AS post_lang, po.title AS post_title, po.published_at AS post_published_at
         FROM projects p LEFT JOIN posts po ON po.id = p.post_id AND po.status = 'published'
         WHERE p.slug = ? AND p.visible = 1 AND TRIM(p.case_html) <> ''`,
      )
      .bind(slug),
    db
      .prepare('SELECT l.kind, l.label, l.url FROM project_links l JOIN projects p ON p.id = l.project_id WHERE p.slug = ? ORDER BY l.sort_order')
      .bind(slug),
    db
      .prepare(`${ACHIEVEMENT_SELECT} WHERE a.visible = 1 AND p.slug = ? ORDER BY a.sort_order, a.year DESC, a.id`)
      .bind(slug),
  ])
  const row = rows<CaseRow>(projectRes)[0]
  if (!row) return null
  const { id: _id, post_kind, post_slug, post_lang, post_title, post_published_at, ...project } = row
  return {
    ...project,
    links: rows<ProjectLink>(linksRes),
    achievements: rows<AchievementRow>(achievementsRes).map(toAchievement),
    post:
      post_kind && post_slug && post_lang && post_title && post_published_at
        ? { kind: post_kind, slug: post_slug, lang: post_lang, title: post_title, published_at: post_published_at }
        : null,
  }
}

// The opening paragraph of a rendered profile is the home page's introduction; /about shows the whole body.
export function firstParagraph(bodyHtml: string): string {
  return bodyHtml.match(/^\s*<p[\s>][\s\S]*?<\/p>/)?.[0] ?? ''
}

export async function findRedirect(db: D1Database, path: string): Promise<string | null> {
  const row = await db.prepare('SELECT to_path FROM redirects WHERE from_path = ?').bind(path).first<{ to_path: string }>()
  return row?.to_path ?? null
}
