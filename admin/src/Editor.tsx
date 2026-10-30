import { useEffect, useMemo, useState } from 'preact/hooks'
import { api, ApiError, type EditablePost, type Kind, type PostSummary, type RevisionDetail } from './api'
import { History } from './History'
import { MarkdownPane } from './MarkdownPane'
import { render } from './render'
import { clearUnsaved, useUnsavedGuard } from './unsaved'

const today = () => new Date().toISOString().slice(0, 10)

function blank(kind: Kind): EditablePost {
  return {
    id: null,
    kind,
    slug: '',
    title: '',
    summary: null,
    lang: 'en',
    status: 'draft',
    published_at: null,
    body_md: '',
    tags: [],
    note: kind === 'note' ? { symptom: '', fix: '', environment: {}, verified_at: today() } : null,
    revision: null,
  }
}

// A translation starts from the saved post: same slug, tags, note box and date, the other language, a draft.
// The text is a starting point to translate, so it is copied as is.
function translationOf(src: EditablePost): EditablePost {
  return { ...src, id: null, revision: null, lang: src.lang === 'en' ? 'tr' : 'en', status: 'draft' }
}

// Versioned so a draft written by an older panel build is ignored rather than crashing the editor.
const draftKey = (id: number | null, kind: Kind, translateOf?: number) =>
  `draft:v1:${id ?? (translateOf ? `translate-${translateOf}` : `new-${kind}`)}`

// The browser keeps an unsaved copy so a closed tab loses nothing; only Save reaches the server.
function readDraft(key: string): EditablePost | null {
  try {
    const raw = localStorage.getItem(key)
    const d = raw ? (JSON.parse(raw) as Partial<EditablePost>) : null
    const valid =
      !!d &&
      typeof d.title === 'string' &&
      typeof d.slug === 'string' &&
      typeof d.body_md === 'string' &&
      Array.isArray(d.tags) &&
      (d.kind === 'note') === (d.note != null && typeof d.note === 'object')
    return valid ? (d as EditablePost) : null
  } catch {
    return null
  }
}

function writeDraft(key: string, post: EditablePost | null) {
  try {
    if (post) localStorage.setItem(key, JSON.stringify(post))
    else localStorage.removeItem(key)
  } catch {
    // Storage can be full or blocked; the editor keeps working without the local copy.
  }
}

const pathOf = (kind: Kind, slug: string, lang: 'en' | 'tr') => `${lang === 'tr' ? '/tr' : ''}/${kind === 'note' ? 'notes' : 'writing'}/${slug}`

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function textToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

type Props = { id: number | null; kind: Kind; translateOf?: number; onSaved: (id: number) => void }

export function Editor({ id, kind, translateOf, onSaved }: Props) {
  const [post, setPost] = useState<EditablePost | null>(id === null && !translateOf ? blank(kind) : null)
  const [server, setServer] = useState<EditablePost | null>(null)
  const [version, setVersion] = useState(0)
  const [pendingDraft, setPendingDraft] = useState<EditablePost | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [envText, setEnvText] = useState('')
  // A translation keeps the slug of the original, so typing the title must not rewrite it.
  const [slugTouched, setSlugTouched] = useState(!!translateOf)
  // null until the post list has loaded: the translation control waits for it instead of guessing.
  const [others, setOthers] = useState<PostSummary[] | null>(null)
  const [othersError, setOthersError] = useState('')
  const [pendingLang, setPendingLang] = useState<'en' | 'tr' | null>(null)
  const key = draftKey(id, kind, translateOf)

  useEffect(() => {
    const load = async () => {
      const loaded = id !== null ? await api.get(id) : translateOf ? translationOf(await api.get(translateOf)) : blank(kind)
      // Nothing is saved yet for a translation, so it counts as unsaved and Save draft stays available.
      setServer(translateOf ? blank(loaded.kind) : loaded)
      setPost(loaded)
      setEnvText(envToText(loaded.note?.environment ?? {}))
      setVersion((v) => v + 1)
      const local = readDraft(key)
      if (local && JSON.stringify(local) !== JSON.stringify(loaded)) setPendingDraft(local)
    }
    load().catch((e: Error) => setError(e.message))
  }, [id, kind, translateOf])

  // While the restore banner is open the stored draft is what it offers, so leave it alone.
  useEffect(() => {
    if (!post || !server || pendingDraft) return
    writeDraft(key, JSON.stringify(post) === JSON.stringify(server) ? null : post)
  }, [post, server, pendingDraft])

  const savedId = server?.id ?? null
  useEffect(() => {
    if (savedId === null) return
    setOthers(null)
    setOthersError('')
    api.list().then(setOthers, (e: Error) => setOthersError(e.message))
  }, [savedId, server?.kind, server?.slug, server?.lang])

  const dirty = useMemo(() => !!post && !!server && JSON.stringify(post) !== JSON.stringify(server), [post, server])
  useUnsavedGuard(dirty)

  if (!post) return <p>{error || 'Loading...'}</p>

  // Functional updates: several inputs can fire before the next render.
  const set = (patch: Partial<EditablePost> | ((p: EditablePost) => Partial<EditablePost>)) =>
    setPost((p) => (p ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p))

  async function save(next: EditablePost, reason: 'save' | 'publish' | 'restore') {
    setBusy(true)
    setError('')
    setStatus('')
    if (!/^[a-z0-9-]+$/.test(next.slug)) {
      setError('The slug may only contain lowercase letters, digits and hyphens.')
      setBusy(false)
      return
    }
    try {
      const html = render(next.body_md)
      const res = await api.save(next, html, reason)
      const stamp = { id: res.id, revision: res.revision, status: next.status, published_at: res.published_at }
      setServer({ ...next, ...stamp })
      // Merge only what the server decided: text typed while the request was in flight stays.
      setPost((p) => (p ? { ...p, ...stamp } : p))
      setStatus(reason === 'publish' ? 'Published.' : 'Saved.')
      if (id === null) {
        clearUnsaved()
        onSaved(res.id)
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}. Your text is kept in this browser.` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function restore(rev: RevisionDetail) {
    setPost({ ...post!, title: rev.title, body_md: rev.body_md })
    setVersion((v) => v + 1)
    setShowHistory(false)
    setStatus(`Loaded revision ${rev.id}. Save to keep it.`)
  }

  const published = post.status === 'published'
  const translation = server && savedId !== null ? others?.find((o) => o.id !== savedId && o.kind === server.kind && o.slug === server.slug && o.lang !== server.lang) : undefined

  return (
    <div class="editor">
      {pendingDraft && (
        <div class="banner" role="status">
          This browser has unsaved changes from an earlier session.
          <button
            type="button"
            onClick={() => {
              // The draft's own revision may be stale; save against the one just loaded.
              setPost({ ...pendingDraft, id: server?.id ?? null, revision: server?.revision ?? null })
              setEnvText(envToText(pendingDraft.note?.environment ?? {}))
              setVersion((v) => v + 1)
              setPendingDraft(null)
            }}
          >
            Restore them
          </button>
          <button
            type="button"
            onClick={() => {
              writeDraft(key, null)
              setPendingDraft(null)
            }}
          >
            Discard
          </button>
        </div>
      )}

      <form class="meta" onSubmit={(e) => e.preventDefault()}>
        <label>
          Title
          <input
            value={post.title}
            onInput={(e) => {
              const title = e.currentTarget.value
              set((p) => ({ title, ...(p.id === null && !slugTouched ? { slug: slugify(title) } : {}) }))
            }}
            required
          />
        </label>
        <label>
          Slug
          <input value={post.slug} onInput={(e) => {
              setSlugTouched(true)
              set({ slug: e.currentTarget.value })
            }} pattern="[a-z0-9-]+" required />
        </label>
        <label>
          Summary
          <input value={post.summary ?? ''} onInput={(e) => set({ summary: e.currentTarget.value || null })} />
        </label>
        <div class="row">
          <label>
            Kind
            <select
              value={post.kind}
              onChange={(e) => {
                const k = e.currentTarget.value as Kind
                set((p) => ({ kind: k, note: k === 'note' ? (p.note ?? blank('note').note) : null }))
              }}
            >
              <option value="note">Note</option>
              <option value="writing">Writing</option>
            </select>
          </label>
          <label>
            Language
            <select
              value={post.lang}
              onChange={(e) => {
                const lang = e.currentTarget.value as 'en' | 'tr'
                // A live post that changes language moves URL, so ask first.
                if (server?.id != null && server.status === 'published' && lang !== server.lang) setPendingLang(lang)
                else set({ lang })
              }}
            >
              <option value="en">English</option>
              <option value="tr">Turkish</option>
            </select>
          </label>
          <label>
            Published on (empty means the day you publish)
            <input
              type="date"
              value={post.published_at?.slice(0, 10) ?? ''}
              onInput={(e) => {
                const day = e.currentTarget.value
                // Noon UTC keeps the date the same in every time zone the site is read from.
                set({ published_at: day ? `${day}T12:00:00Z` : null })
              }}
            />
          </label>
          <label>
            Tags
            <input
              value={post.tags.join(', ')}
              onInput={(e) => set({ tags: e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="linux, bluetooth"
            />
          </label>
        </div>

        {pendingLang && server && (
          <div class="banner" role="alert">
            This post is published. Changing its language moves it from {pathOf(server.kind, server.slug, server.lang)} to {pathOf(post.kind, post.slug, pendingLang)}, and
            the old URL will redirect (301) to the new one.
            <button
              type="button"
              onClick={() => {
                set({ lang: pendingLang })
                setPendingLang(null)
              }}
            >
              Change language
            </button>
            <button type="button" onClick={() => setPendingLang(null)}>
              Keep {server.lang === 'en' ? 'English' : 'Turkish'}
            </button>
          </div>
        )}

        {post.note && (
          <fieldset class="note-box">
            <legend>Symptom and fix</legend>
            <label>
              Symptom (what a reader searches for)
              <textarea rows={2} value={post.note.symptom} onInput={(e) => { const v = e.currentTarget.value; set((p) => ({ note: { ...p.note!, symptom: v } })) }} />
            </label>
            <label>
              Fix
              <textarea rows={2} value={post.note.fix} onInput={(e) => { const v = e.currentTarget.value; set((p) => ({ note: { ...p.note!, fix: v } })) }} />
            </label>
            <div class="row">
              <label>
                Environment, one "key: value" per line
                <textarea
                  rows={3}
                  value={envText}
                  onInput={(e) => {
                    const text = e.currentTarget.value
                    setEnvText(text)
                    set((p) => ({ note: { ...p.note!, environment: textToEnv(text) } }))
                  }}
                  placeholder={'kernel: 7.2.11\ndistro: Arch'}
                />
              </label>
              <label>
                Verified on
                <input type="date" value={post.note.verified_at} onInput={(e) => { const v = e.currentTarget.value; set((p) => ({ note: { ...p.note!, verified_at: v } })) }} />
              </label>
            </div>
          </fieldset>
        )}
      </form>

      <MarkdownPane value={post.body_md} onChange={(body_md) => set({ body_md })} version={version} title={post.title} onStatus={setStatus} onError={setError} />

      <div class="actions">
        <p class="state" role="status" aria-live="polite">
          {error ? <span class="error">{error}</span> : status || (dirty ? 'Unsaved changes' : published ? 'Published' : post.id ? 'Draft' : 'New')}
        </p>
        {post.id !== null && othersError && <span class="error">Translations: {othersError}</span>}
        {post.id !== null && others && (
          <a class="button" href={translation ? `#/edit/${translation.id}` : `#/translate/${post.id}`}>
            {translation ? 'Open translation' : 'Add translation'}
          </a>
        )}
        {post.id !== null && (
          <button type="button" onClick={() => setShowHistory(!showHistory)}>
            History
          </button>
        )}
        <button type="button" disabled={busy || !dirty} onClick={() => save(post, 'save')}>
          {published ? 'Save changes' : 'Save draft'}
        </button>
        {published ? (
          <button type="button" disabled={busy} onClick={() => save({ ...post, status: 'draft' }, 'save')}>
            Unpublish
          </button>
        ) : (
          <button type="button" class="primary" disabled={busy || !post.title || !post.slug} onClick={() => save({ ...post, status: 'published' }, 'publish')}>
            Publish
          </button>
        )}
      </div>

      {showHistory && post.id !== null && <History key={post.id} loadList={() => api.revisions(post.id!)} loadOne={(rev) => api.revision(post.id!, rev)} current={post.body_md} onRestore={restore} onClose={() => setShowHistory(false)} />}
    </div>
  )
}
