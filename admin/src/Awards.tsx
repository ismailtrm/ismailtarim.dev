import { useEffect, useState } from 'preact/hooks'
import { api, type AchievementKind, type AchievementSummary, type EditableAchievement, type ProjectSummary } from './api'
import { LinksEditor } from './LinksEditor'
import { RecordActions, useRecordEditor } from './RecordEditor'

const KIND_LABEL: Record<AchievementKind, string> = { award: 'Award', contribution: 'Contribution' }

export function AchievementList() {
  const [items, setItems] = useState<AchievementSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.achievements().then(setItems, (e: Error) => setError(e.message))
  }, [])
  return (
    <section>
      <div class="list-actions">
        <a class="button primary" href="#/awards/new">
          New entry
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {!items && !error && <p>Loading awards...</p>}
      {items && items.length === 0 && <p>No awards or contributions yet.</p>}
      {items && items.length > 0 && (
        <table class="post-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Kind</th>
              <th scope="col">Year</th>
              <th scope="col">Visible</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={`#/awards/${a.id}`}>{a.title}</a>
                </td>
                <td>{KIND_LABEL[a.kind]}</td>
                <td>{a.year}</td>
                <td>{a.visible ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function blank(): EditableAchievement {
  return {
    id: null,
    kind: 'award',
    title: '',
    context: '',
    outcome: '',
    summary: '',
    year: new Date().getFullYear(),
    sort_order: 0,
    visible: false,
    project_id: null,
    updated_at: null,
    links: [],
  }
}

export function AchievementEditor({ id }: { id: number | null }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const editor = useRecordEditor<EditableAchievement>({
    id,
    blank,
    load: api.achievement,
    save: api.saveAchievement,
    remove: api.deleteAchievement,
    route: '/awards',
  })
  const { record: item, set, setError, error } = editor

  useEffect(() => {
    api.projects().then(setProjects, (e: Error) => setError(e.message))
  }, [])

  if (!item) return <p>{error || 'Loading...'}</p>

  return (
    <div class="editor">
      <form class="meta" onSubmit={(e) => e.preventDefault()}>
        <div class="row">
          <label>
            Title
            <input value={item.title} onInput={(e) => set({ title: e.currentTarget.value })} required />
          </label>
          <label>
            Kind
            <select value={item.kind} onChange={(e) => set({ kind: e.currentTarget.value as AchievementKind })}>
              {(Object.keys(KIND_LABEL) as AchievementKind[]).map((k) => (
                <option value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
        </div>
        <div class="row">
          <label>
            Event or project
            <input value={item.context} onInput={(e) => set({ context: e.currentTarget.value })} />
          </label>
          <label>
            Outcome
            <input value={item.outcome} placeholder="2nd in Turkey" onInput={(e) => set({ outcome: e.currentTarget.value })} />
          </label>
        </div>
        <label>
          Summary
          <input value={item.summary} onInput={(e) => set({ summary: e.currentTarget.value })} />
        </label>
        <div class="row">
          <label>
            Year
            <input type="number" value={item.year} onInput={(e) => set({ year: Number(e.currentTarget.value) })} />
          </label>
          <label>
            Sort order (lower comes first)
            <input type="number" value={item.sort_order} onInput={(e) => set({ sort_order: Number(e.currentTarget.value) })} />
          </label>
        </div>
        <label>
          Project
          <select value={item.project_id ?? ''} onChange={(e) => set({ project_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
            <option value="">None</option>
            {projects.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <div class="checks">
          <label class="check">
            <input type="checkbox" checked={item.visible} onChange={(e) => set({ visible: e.currentTarget.checked })} />
            Visible
          </label>
        </div>
        <LinksEditor legend="Links" items={item.links} onChange={(links) => set({ links })} newItem={() => ({ label: '', url: '' })} />
      </form>
      <RecordActions editor={editor} saved={item.id !== null} deletePrompt="Delete this entry?" canSave={!!item.title.trim()} />
    </div>
  )
}
