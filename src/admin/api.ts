import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../env'
import { readStats, rollupRecent } from '../stats'
import { requireAccess } from './access'
import { deleteProject, getProjectForEdit, listAllProjects, saveProject } from './project-store'
import { getProfileForEdit, getProfileRevision, listProfileRevisions, saveProfile } from './profile-store'
import { postInput, profileInput, profileLang, projectInput } from './schema'
import { ConflictError, InputError, getPostForEdit, getRevision, listAllPosts, listRevisions, savePost } from './store'

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const api = new Hono<{ Bindings: Env }>()

api.use(csrf())
api.use(requireAccess())

api.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409)
  if (err instanceof InputError) return c.json({ error: err.message }, 400)
  if (err.message.includes('UNIQUE constraint failed: posts.kind, posts.lang, posts.slug')) {
    return c.json({ error: 'another post of this kind and language already uses this slug' }, 409)
  }
  if (err.message.includes('UNIQUE constraint failed: projects.slug')) {
    return c.json({ error: 'another project already uses this slug' }, 409)
  }
  if (err.message.includes('FOREIGN KEY constraint failed')) {
    return c.json({ error: 'the linked post does not exist' }, 400)
  }
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

function id(raw: string): number | null {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

api.get('/posts', async (c) => c.json(await listAllPosts(c.env.DB)))

api.get('/stats', async (c) => {
  const days = clampDays(c.req.query('days'), 30, 3650)
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  return c.json(await readStats(c.env.DB, since))
})

// Re-copies past days from Analytics Engine, which keeps raw events for about 90 days.
// The nightly job covers only the last 3, so this is how older days get in (first token, missed nights).
api.post('/stats/rollup', async (c) => {
  if (!c.env.AE_API_TOKEN) return c.json({ error: 'AE_API_TOKEN is not set' }, 409)
  await rollupRecent(c.env, new Date(), clampDays(c.req.query('days'), 3, 90))
  return c.json({ ok: true })
})

function clampDays(raw: string | undefined, fallback: number, max: number): number {
  const n = Math.trunc(Number(raw ?? fallback))
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback
}

api.get('/posts/:id', async (c) => {
  const postId = id(c.req.param('id'))
  const post = postId ? await getPostForEdit(c.env.DB, postId) : null
  return post ? c.json(post) : c.json({ error: 'not found' }, 404)
})

const jsonLimit = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'post is larger than 2 MB' }, 413) })

async function readPost(req: Request) {
  return postInput.safeParse(await req.json().catch(() => null))
}

api.post('/posts', jsonLimit, async (c) => {
  const parsed = await readPost(c.req.raw)
  if (!parsed.success) return c.json({ error: 'invalid post', issues: parsed.error.issues }, 400)
  return c.json(await savePost(c.env.DB, null, parsed.data), 201)
})

api.put('/posts/:id', jsonLimit, async (c) => {
  const postId = id(c.req.param('id'))
  if (!postId) return c.json({ error: 'not found' }, 404)
  const parsed = await readPost(c.req.raw)
  if (!parsed.success) return c.json({ error: 'invalid post', issues: parsed.error.issues }, 400)
  return c.json(await savePost(c.env.DB, postId, parsed.data))
})

api.get('/posts/:id/revisions', async (c) => {
  const postId = id(c.req.param('id'))
  return postId ? c.json(await listRevisions(c.env.DB, postId)) : c.json({ error: 'not found' }, 404)
})

api.get('/posts/:id/revisions/:rev', async (c) => {
  const postId = id(c.req.param('id'))
  const revId = id(c.req.param('rev'))
  const rev = postId && revId ? await getRevision(c.env.DB, postId, revId) : null
  return rev ? c.json(rev) : c.json({ error: 'not found' }, 404)
})

function lang(raw: string) {
  const parsed = profileLang.safeParse(raw)
  return parsed.success ? parsed.data : null
}

api.get('/profile/:lang', async (c) => {
  const l = lang(c.req.param('lang'))
  return l ? c.json(await getProfileForEdit(c.env.DB, l)) : c.json({ error: 'not found' }, 404)
})

api.put('/profile/:lang', jsonLimit, async (c) => {
  const l = lang(c.req.param('lang'))
  if (!l) return c.json({ error: 'not found' }, 404)
  const parsed = profileInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid profile', issues: parsed.error.issues }, 400)
  return c.json(await saveProfile(c.env.DB, l, parsed.data))
})

api.get('/profile/:lang/revisions', async (c) => {
  const l = lang(c.req.param('lang'))
  return l ? c.json(await listProfileRevisions(c.env.DB, l)) : c.json({ error: 'not found' }, 404)
})

api.get('/profile/:lang/revisions/:rev', async (c) => {
  const l = lang(c.req.param('lang'))
  const revId = id(c.req.param('rev'))
  const rev = l && revId ? await getProfileRevision(c.env.DB, l, revId) : null
  return rev ? c.json(rev) : c.json({ error: 'not found' }, 404)
})

api.get('/projects', async (c) => c.json(await listAllProjects(c.env.DB)))

api.get('/projects/:id', async (c) => {
  const projectId = id(c.req.param('id'))
  const project = projectId ? await getProjectForEdit(c.env.DB, projectId) : null
  return project ? c.json(project) : c.json({ error: 'not found' }, 404)
})

async function readProject(req: Request) {
  return projectInput.safeParse(await req.json().catch(() => null))
}

api.post('/projects', jsonLimit, async (c) => {
  const parsed = await readProject(c.req.raw)
  if (!parsed.success) return c.json({ error: 'invalid project', issues: parsed.error.issues }, 400)
  return c.json(await saveProject(c.env.DB, null, parsed.data), 201)
})

api.put('/projects/:id', jsonLimit, async (c) => {
  const projectId = id(c.req.param('id'))
  if (!projectId) return c.json({ error: 'not found' }, 404)
  const parsed = await readProject(c.req.raw)
  if (!parsed.success) return c.json({ error: 'invalid project', issues: parsed.error.issues }, 400)
  return c.json(await saveProject(c.env.DB, projectId, parsed.data))
})

api.delete('/projects/:id', async (c) => {
  const projectId = id(c.req.param('id'))
  return projectId && (await deleteProject(c.env.DB, projectId)) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
})

// The body is buffered rather than streamed: R2 needs a known length, and bodyLimit's stream wrapper drops it.
api.post(
  '/uploads',
  bodyLimit({ maxSize: MAX_IMAGE_BYTES, onError: (c) => c.json({ error: 'image is larger than 20 MB' }, 413) }),
  async (c) => {
    const type = (c.req.header('Content-Type') ?? '').split(';')[0]?.trim() ?? ''
    const ext = IMAGE_TYPES[type]
    if (!ext) return c.json({ error: `unsupported image type: ${type || 'none'}` }, 415)
    const alt = (c.req.query('alt') ?? '').trim()
    if (!alt) return c.json({ error: 'alt text is required' }, 400)
    const width = id(c.req.query('w') ?? '')
    const height = id(c.req.query('h') ?? '')
    const body = await c.req.arrayBuffer()
    if (body.byteLength === 0) return c.json({ error: 'empty body' }, 400)

    const key = `img/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${ext}`
    await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type } })
    try {
      await c.env.DB.prepare('INSERT INTO assets (r2_key, alt, width, height, content_type) VALUES (?, ?, ?, ?, ?)')
        .bind(key, alt, width, height, type)
        .run()
    } catch (err) {
      await c.env.MEDIA.delete(key)
      throw err
    }
    return c.json({ url: `/media/${key}`, alt, width, height }, 201)
  },
)

export default api
