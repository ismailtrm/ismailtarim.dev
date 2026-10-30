import { useEffect, useState } from 'preact/hooks'
import { api, ApiError, type EditableProject, type PostSummary, type ProjectStatus, type ProjectSummary } from './api'
import { LinksEditor } from './LinksEditor'
import { MarkdownPane } from './MarkdownPane'
import { render } from './render'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  merged: 'Merged',
  under_review: 'Under review',
  submitted: 'Submitted',
  published: 'Published',
  personal: 'Personal tool',
}

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.projects().then(setProjects, (e: Error) => setError(e.message))
  }, [])
  return (
    <section>
      <div class="list-actions">
        <a class="button primary" href="#/projects/new">
          New project
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {!projects && !error && <p>Loading projects...</p>}
      {projects && projects.length === 0 && <p>No projects yet.</p>}
      {projects && projects.length > 0 && (
        <table class="post-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Year</th>
              <th scope="col">Status</th>
              <th scope="col">Visible</th>
              <th scope="col">On home page</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`#/projects/${p.id}`}>{p.name}</a>
                </td>
                <td>{p.year}</td>
                <td>{STATUS_LABEL[p.status]}</td>
                <td>{p.visible ? 'Yes' : 'No'}</td>
                <td>{p.featured ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function blank(): EditableProject {
  return {
    id: null,
    slug: '',
    name: '',
    summary: '',
    year: new Date().getFullYear(),
    status: 'personal',
    status_label: null,
    case_md: null,
    sort_order: 0,
    visible: false,
    featured: false,
    post_id: null,
    updated_at: null,
    links: [],
  }
}

export function ProjectEditor({ id }: { id: number | null }) {
  const [project, setProject] = useState<EditableProject | null>(id === null ? blank() : null)
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (id !== null) api.project(id).then(setProject, (e: Error) => setError(e.message))
    api.list().then(setPosts, (e: Error) => setError(e.message))
  }, [id])

  if (!project) return <p>{error || 'Loading...'}</p>

  // Only published posts can be picked; the post already linked stays in the list even if it was unpublished since.
  const linkable = posts.filter((p) => p.status === 'published' || p.id === project.post_id)
  const set = (patch: Partial<EditableProject>) => setProject((p) => (p ? { ...p, ...patch } : p))

  async function save(p: EditableProject) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const hasCase = !!p.case_md?.trim()
      const res = await api.saveProject(p, hasCase ? render(p.case_md!) : null)
      set({ updated_at: res.updated_at })
      setStatus('Saved.')
      if (p.id === null) location.replace(`#/projects/${res.id}`)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}. Reload the page to get the latest version.` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(projectId: number) {
    setBusy(true)
    try {
      await api.deleteProject(projectId)
      location.hash = '#/projects'
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div class="editor">
      <form class="meta" onSubmit={(e) => e.preventDefault()}>
        <div class="row">
          <label>
            Name
            <input value={project.name} onInput={(e) => set({ name: e.currentTarget.value })} required />
          </label>
          <label>
            Slug
            <input value={project.slug} onInput={(e) => set({ slug: e.currentTarget.value })} pattern="[a-z0-9-]+" required />
          </label>
        </div>
        <label>
          Summary
          <input value={project.summary} onInput={(e) => set({ summary: e.currentTarget.value })} required />
        </label>
        <div class="row">
          <label>
            Year
            <input type="number" value={project.year} onInput={(e) => set({ year: Number(e.currentTarget.value) })} />
          </label>
          <label>
            Status
            <select value={project.status} onChange={(e) => set({ status: e.currentTarget.value as ProjectStatus })}>
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                <option value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label>
            Status text (optional, replaces the label)
            <input type="text" maxLength={60} value={project.status_label ?? ''} onInput={(e) => set({ status_label: e.currentTarget.value || null })} />
          </label>
          <label>
            Sort order (lower comes first)
            <input type="number" value={project.sort_order} onInput={(e) => set({ sort_order: Number(e.currentTarget.value) })} />
          </label>
          <label>
            Linked post
            <select value={project.post_id ?? ''} onChange={(e) => set({ post_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">None</option>
              {linkable.map((p) => (
                <option value={p.id}>
                  {p.title} ({p.lang.toUpperCase()}, {p.kind}){p.status === 'published' ? '' : ' (unpublished)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="checks">
          <label class="check">
            <input
              type="checkbox"
              checked={project.visible}
              onChange={(e) => {
                const visible = e.currentTarget.checked
                set(visible ? { visible } : { visible, featured: false })
              }}
            />
            Visible
          </label>
          <label class="check">
            <input type="checkbox" checked={project.featured} disabled={!project.visible} onChange={(e) => set({ featured: e.currentTarget.checked })} />
            Show on home page
          </label>
        </div>
        <LinksEditor
          legend="Evidence links"
          items={project.links}
          onChange={(links) => set({ links })}
          newItem={() => ({ kind: 'commit' as const, label: '', url: '' })}
          withKind
        />
      </form>
      <h2>Case study (optional)</h2>
      <MarkdownPane value={project.case_md ?? ''} onChange={(case_md) => set({ case_md })} version={0} onStatus={setStatus} onError={setError} />
      <div class="actions">
        <p class="state" role="status" aria-live="polite">
          {error ? <span class="error">{error}</span> : status}
        </p>
        {project.id !== null && !confirming && (
          <button type="button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        {project.id !== null && confirming && (
          <span class="confirm" role="alert">
            Delete this project and its links?
            <button type="button" disabled={busy} onClick={() => remove(project.id!)}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        )}
        <button type="button" class="primary" disabled={busy || !project.name.trim() || !project.slug} onClick={() => save(project)}>
          Save
        </button>
      </div>
    </div>
  )
}
