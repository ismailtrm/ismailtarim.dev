import { z } from 'zod'

const slug = z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens')
const isoSeconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'YYYY-MM-DDTHH:MM:SSZ')

const noteMeta = z.object({
  symptom: z.string().min(1).max(2000),
  fix: z.string().min(1).max(2000),
  environment: z.record(z.string().max(60), z.string().max(200)),
  verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
})

// Markdown and the HTML rendered from it in the panel. The HTML is trusted because only the
// owner can reach this endpoint; the public CSP blocks inline script either way.
export const postInput = z
  .object({
    kind: z.enum(['writing', 'note']),
    slug,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(400).nullable(),
    lang: z.enum(['en', 'tr']),
    status: z.enum(['draft', 'published', 'archived']),
    published_at: isoSeconds.nullable(),
    body_md: z.string().max(400_000),
    body_html: z.string().max(1_000_000),
    tags: z.array(z.string().trim().min(1).max(40)).max(12),
    note: noteMeta.nullable(),
    reason: z.enum(['save', 'publish', 'restore']),
    // Optimistic lock: the newest revision id the editor loaded. Null when creating.
    // Timestamps are not enough: two saves within one second share updated_at.
    base_revision: z.number().int().positive().nullable(),
  })
  .refine((p) => new Set(p.tags.map(tagSlug)).size === p.tags.length && p.tags.every((t) => tagSlug(t) !== ''), {
    message: 'each tag needs Latin letters or digits, and two tags must not reduce to the same slug',
    path: ['tags'],
  })
  .refine((p) => (p.kind === 'note') === (p.note !== null), {
    message: 'notes need symptom, fix and environment; essays must not have them',
    path: ['note'],
  })

export type PostInput = z.infer<typeof postInput>

// The public site only links http(s) URLs; the database CHECK on project_links says the same.
const httpUrl = z.string().max(500).regex(/^https?:\/\/\S+$/, 'an http(s) URL')
const labelledUrl = z.object({ label: z.string().trim().min(1).max(60), url: httpUrl })
const profileLink = labelledUrl.extend({
  url: z.string().max(500).regex(/^(https?:\/\/\S+|mailto:[^\s@]+@[^\s@]+)$/, 'an http(s) or mailto URL'),
})

export const profileLang = z.enum(['en', 'tr'])

export const profileInput = z.object({
  name: z.string().trim().min(1).max(120),
  headline: z.string().trim().max(300),
  location: z.string().trim().max(120),
  links: z.array(profileLink).max(12),
  badges: z.array(labelledUrl).max(12),
  avatar_key: z.string().max(200).regex(/^img(?:\/[\w-]+(?:\.[\w-]+)*)+$/, 'an uploaded image key').nullable(),
  body_md: z.string().max(400_000),
  body_html: z.string().max(1_000_000),
  reason: z.enum(['save', 'publish', 'restore']),
  // The newest profile revision id the editor loaded for this language. Null while no profile exists.
  base_revision: z.number().int().positive().nullable(),
})

export type ProfileInput = z.infer<typeof profileInput>

export const projectInput = z
  .object({
    slug,
    name: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(400),
    year: z.number().int().min(1970).max(2100),
    status: z.enum(['merged', 'under_review', 'submitted', 'published', 'personal']),
    case_md: z.string().max(400_000).nullable(),
    case_html: z.string().max(1_000_000).nullable(),
    sort_order: z.number().int().min(-100_000).max(100_000),
    visible: z.boolean(),
    featured: z.boolean(),
    post_id: z.number().int().positive().nullable(),
    // The updated_at the editor loaded (millisecond ISO); null when creating.
    base_updated_at: z.string().max(40).nullable(),
    links: z
      .array(labelledUrl.extend({ kind: z.enum(['commit', 'pr', 'patch', 'paper', 'repo', 'demo', 'talk']) }))
      .max(30),
  })
  .refine((p) => !p.featured || p.visible, {
    message: 'a project must be visible to be featured on the home page',
    path: ['featured'],
  })
  .refine((p) => ((p.case_md ?? '').trim() === '') === ((p.case_html ?? '').trim() === ''), {
    message: 'case study text and its rendered HTML must both be filled or both empty',
    path: ['case_html'],
  })

export type ProjectInput = z.infer<typeof projectInput>

export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/ı/g, 'i')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
