import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../env'
import { requireAccess } from './access'
import { postInput } from './schema'
import { ConflictError, getPostForEdit, getRevision, listAllPosts, listRevisions, savePost } from './store'

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
  if (err.message.includes('UNIQUE constraint failed: posts.kind, posts.slug')) {
    return c.json({ error: 'another post of this kind already uses this slug' }, 409)
  }
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

function id(raw: string): number | null {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

api.get('/posts', async (c) => c.json(await listAllPosts(c.env.DB)))

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
