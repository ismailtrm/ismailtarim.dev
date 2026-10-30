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

export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/ı/g, 'i')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
