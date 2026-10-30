import { diffLines } from 'diff'
import { useEffect, useState } from 'preact/hooks'
import { api, type Revision, type RevisionDetail } from './api'

type Props = {
  postId: number
  current: string
  onRestore: (rev: RevisionDetail) => void
  onClose: () => void
}

export function History({ postId, current, onRestore, onClose }: Props) {
  const [list, setList] = useState<Revision[] | null>(null)
  const [picked, setPicked] = useState<RevisionDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.revisions(postId).then(setList, (e: Error) => setError(e.message))
  }, [postId])

  async function open(rev: Revision) {
    setError('')
    try {
      setPicked(await api.revision(postId, rev.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section class="history" aria-label="Revision history">
      <header>
        <h2>History</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!list && !error && <p>Loading revisions...</p>}
      {list && (
        <ol class="revisions">
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" aria-pressed={picked?.id === r.id} onClick={() => open(r)}>
                <time>{r.created_at.replace('T', ' ').replace('Z', ' UTC')}</time> <span>{r.reason}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {picked && (
        <div class="diff-view">
          <p>
            Changes from revision {picked.id} to the text in the editor. Restoring loads the revision into the editor; nothing is
            saved until you save.
          </p>
          <pre class="diff">
            {diffLines(picked.body_md, current).map((part, i) => (
              <span key={i} class={part.added ? 'add' : part.removed ? 'del' : 'same'}>
                {part.value}
              </span>
            ))}
          </pre>
          <button type="button" onClick={() => onRestore(picked)}>
            Load revision {picked.id} into the editor
          </button>
        </div>
      )}
    </section>
  )
}
