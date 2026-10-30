import { useEffect, useMemo, useState } from 'preact/hooks'
import { ApiError } from './api'
import { clearUnsaved, useUnsavedGuard } from './unsaved'

// A save may also report the share card it uploaded.
type Saved = { id: number; updated_at: string; og_key?: string | null }
type Stored = { id: number | null; updated_at: string | null }

type Options<T> = {
  id: number | null
  blank: () => T
  load: (id: number) => Promise<T>
  // stored: the record as last saved, to tell whether derived output must change.
  save: (record: T, stored: T | null) => Promise<Saved>
  remove: (id: number) => Promise<unknown>
  // The list route; a saved record lives at `${route}/${id}`.
  route: string
}

// Load, edit, save and delete for a record guarded by updated_at. Projects and awards differ only in their fields.
export function useRecordEditor<T extends Stored>({ id, blank, load, save, remove, route }: Options<T>) {
  const [record, setRecord] = useState<T | null>(() => (id === null ? blank() : null))
  const [server, setServer] = useState<T | null>(record)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id === null) return
    load(id).then(
      (loaded) => {
        setRecord(loaded)
        setServer(loaded)
      },
      (e: Error) => setError(e.message),
    )
  }, [id])

  const dirty = useMemo(() => JSON.stringify(record) !== JSON.stringify(server), [record, server])
  useUnsavedGuard(dirty)

  const set = (patch: Partial<T>) => setRecord((r) => (r ? { ...r, ...patch } : r))

  async function saveRecord() {
    if (!record) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const res = await save(record, server)
      const stamp = { updated_at: res.updated_at, ...(res.og_key === undefined ? {} : { og_key: res.og_key }) }
      setServer({ ...record, ...stamp })
      // Text typed while the request was in flight stays, and still counts as unsaved.
      setRecord((r) => (r ? { ...r, ...stamp } : r))
      setStatus('Saved.')
      if (record.id === null) {
        clearUnsaved()
        location.replace(`#${route}/${res.id}`)
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}. Reload the page to get the latest version.` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeRecord() {
    if (record?.id == null) return
    setBusy(true)
    try {
      await remove(record.id)
      clearUnsaved()
      location.hash = `#${route}`
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return { record, set, setStatus, setError, status, error, busy, dirty, saveRecord, removeRecord }
}

type ActionsProps = {
  editor: Pick<ReturnType<typeof useRecordEditor>, 'status' | 'error' | 'busy' | 'dirty' | 'saveRecord' | 'removeRecord'>
  saved: boolean
  deletePrompt: string
  canSave: boolean
}

// Save stays enabled without changes: saving re-renders the HTML from text changed directly in the database.
export function RecordActions({ editor, saved, deletePrompt, canSave }: ActionsProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div class="actions">
      <p class="state" role="status" aria-live="polite">
        {editor.error ? <span class="error">{editor.error}</span> : editor.status && !editor.dirty ? editor.status : editor.dirty ? 'Unsaved changes' : ''}
      </p>
      {saved && !confirming && (
        <button type="button" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
      {saved && confirming && (
        <span class="confirm" role="alert">
          {deletePrompt}
          <button type="button" disabled={editor.busy} onClick={editor.removeRecord}>
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      )}
      <button type="button" class="primary" disabled={editor.busy || !canSave} onClick={editor.saveRecord}>
        Save
      </button>
    </div>
  )
}
