// Thin client for /admin/api. Cloudflare Access sets its cookie on /admin, so same-origin
// fetches are authenticated without any token handling here.

export type Kind = 'writing' | 'note'
export type Status = 'draft' | 'published' | 'archived'

export type NoteBox = { symptom: string; fix: string; environment: Record<string, string>; verified_at: string }

export type PostSummary = { id: number; kind: Kind; slug: string; title: string; lang: 'en' | 'tr'; status: Status; published_at: string | null; updated_at: string }

export type EditablePost = {
  id: number | null
  kind: Kind
  slug: string
  title: string
  summary: string | null
  lang: 'en' | 'tr'
  status: Status
  published_at: string | null
  body_md: string
  tags: string[]
  note: NoteBox | null
  revision: number | null
}

export type Revision = { id: number; title: string; reason: string; created_at: string }
export type RevisionDetail = Revision & { body_md: string; meta_json: string | null }

export type ClientClass = 'human' | 'ai' | 'search' | 'bot'
export type Stats = {
  since: string
  byPath: { path: string; client_class: ClientClass; reads: number }[]
  byAgent: { client_class: ClientClass; agent: string; reads: number }[]
  byCountry: { country: string; client_class: ClientClass; reads: number }[]
}

export type LabelledUrl = { label: string; url: string }
export type ProfileLang = 'en' | 'tr'
export type EditableProfile = {
  lang: ProfileLang
  name: string
  headline: string
  location: string
  links: LabelledUrl[]
  badges: LabelledUrl[]
  avatar_key: string | null
  body_md: string
  revision: number | null
}

export type ProjectStatus = 'merged' | 'under_review' | 'submitted' | 'published' | 'personal'
export const LINK_KINDS = ['commit', 'pr', 'patch', 'paper', 'repo', 'demo', 'talk'] as const
export type ProjectLinkKind = (typeof LINK_KINDS)[number]
export type ProjectLink = LabelledUrl & { kind: ProjectLinkKind }
export type ProjectSummary = { id: number; slug: string; name: string; year: number; status: ProjectStatus; sort_order: number; visible: number; featured: number }
export type EditableProject = {
  id: number | null
  slug: string
  name: string
  summary: string
  year: number
  status: ProjectStatus
  case_md: string | null
  sort_order: number
  visible: boolean
  featured: boolean
  post_id: number | null
  // The newest save the editor loaded; the server refuses a save made from an older copy. Null while creating.
  updated_at: string | null
  links: ProjectLink[]
}

export type AchievementKind = 'award' | 'contribution'
export type AchievementSummary = { id: number; kind: AchievementKind; title: string; year: number; sort_order: number; visible: number }
export type EditableAchievement = {
  id: number | null
  kind: AchievementKind
  title: string
  context: string
  outcome: string
  summary: string
  year: number
  sort_order: number
  visible: boolean
  // The newest save the editor loaded; the server refuses a save made from an older copy. Null while creating.
  updated_at: string | null
  links: LabelledUrl[]
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Access answers an expired session with a redirect to its login page on another origin.
  const expired = new ApiError('Your session expired. Reload the page to sign in again.', 401)
  let res: Response
  try {
    res = await fetch(`/admin/api${path}`, { ...init, credentials: 'same-origin', redirect: 'manual' })
  } catch {
    throw new ApiError('The request did not reach the server. Check the connection and try again.', 0)
  }
  if (res.type === 'opaqueredirect') throw expired
  const body = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null
  if (!res.ok) {
    const detail = body?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new ApiError(detail || body?.error || `Request failed (${res.status})`, res.status)
  }
  return body as T
}

export const api = {
  list: () => call<PostSummary[]>('/posts'),
  stats: (days: number) => call<Stats>(`/stats?days=${days}`),
  get: (id: number) => call<EditablePost>(`/posts/${id}`),
  save: (post: EditablePost, bodyHtml: string, reason: 'save' | 'publish' | 'restore') => {
    const { id, revision, ...fields } = post
    const payload = JSON.stringify({ ...fields, body_html: bodyHtml, reason, base_revision: revision })
    return call<{ id: number; revision: number; published_at: string | null }>(id ? `/posts/${id}` : '/posts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  },
  revisions: (id: number) => call<Revision[]>(`/posts/${id}/revisions`),
  revision: (id: number, rev: number) => call<RevisionDetail>(`/posts/${id}/revisions/${rev}`),
  profile: (lang: ProfileLang) => call<EditableProfile>(`/profile/${lang}`),
  saveProfile: (p: EditableProfile, bodyHtml: string, reason: 'save' | 'restore') => {
    const { lang, revision, ...fields } = p
    return call<{ revision: number }>(`/profile/${lang}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, body_html: bodyHtml, reason, base_revision: revision }),
    })
  },
  profileRevisions: (lang: ProfileLang) => call<Revision[]>(`/profile/${lang}/revisions`),
  profileRevision: (lang: ProfileLang, rev: number) => call<RevisionDetail>(`/profile/${lang}/revisions/${rev}`),
  projects: () => call<ProjectSummary[]>('/projects'),
  project: (id: number) => call<EditableProject>(`/projects/${id}`),
  saveProject: (p: EditableProject, caseHtml: string | null) => {
    const { id, updated_at, ...fields } = p
    return call<{ id: number; updated_at: string }>(id ? `/projects/${id}` : '/projects', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, case_html: caseHtml, base_updated_at: updated_at }),
    })
  },
  deleteProject: (id: number) => call<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  achievements: () => call<AchievementSummary[]>('/achievements'),
  achievement: (id: number) => call<EditableAchievement>(`/achievements/${id}`),
  saveAchievement: (a: EditableAchievement) => {
    const { id, updated_at, ...fields } = a
    return call<{ id: number; updated_at: string }>(id ? `/achievements/${id}` : '/achievements', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, base_updated_at: updated_at }),
    })
  },
  deleteAchievement: (id: number) => call<{ ok: true }>(`/achievements/${id}`, { method: 'DELETE' }),
  upload: (file: File, alt: string, width: number, height: number) =>
    call<{ url: string; alt: string }>(`/uploads?${new URLSearchParams({ alt, w: String(width), h: String(height) })}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    }),
}
