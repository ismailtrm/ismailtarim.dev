import { useEffect, useState } from 'preact/hooks'
import { api, ApiError, type AchievementKind, type AchievementSummary, type EditableAchievement } from './api'
import { LinksEditor } from './LinksEditor'

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
    updated_at: null,
    links: [],
  }
}

export function AchievementEditor({ id }: { id: number | null }) {
  const [item, setItem] = useState<EditableAchievement | null>(id === null ? blank() : null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (id !== null) api.achievement(id).then(setItem, (e: Error) => setError(e.message))
  }, [id])

  if (!item) return <p>{error || 'Loading...'}</p>

  const set = (patch: Partial<EditableAchievement>) => setItem((a) => (a ? { ...a, ...patch } : a))

  async function save(a: EditableAchievement) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const res = await api.saveAchievement(a)
      set({ updated_at: res.updated_at })
      setStatus('Saved.')
      if (a.id === null) location.replace(`#/awards/${res.id}`)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}. Reload the page to get the latest version.` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(itemId: number) {
    setBusy(true)
    try {
      await api.deleteAchievement(itemId)
      location.hash = '#/awards'
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
        <div class="checks">
          <label class="check">
            <input type="checkbox" checked={item.visible} onChange={(e) => set({ visible: e.currentTarget.checked })} />
            Visible
          </label>
        </div>
        <LinksEditor legend="Links" items={item.links} onChange={(links) => set({ links })} newItem={() => ({ label: '', url: '' })} />
      </form>
      <div class="actions">
        <p class="state" role="status" aria-live="polite">
          {error ? <span class="error">{error}</span> : status}
        </p>
        {item.id !== null && !confirming && (
          <button type="button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        {item.id !== null && confirming && (
          <span class="confirm" role="alert">
            Delete this entry?
            <button type="button" disabled={busy} onClick={() => remove(item.id!)}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        )}
        <button type="button" class="primary" disabled={busy || !item.title.trim()} onClick={() => save(item)}>
          Save
        </button>
      </div>
    </div>
  )
}
