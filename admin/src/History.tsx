import { diffLines } from 'diff'
import { useEffect, useState } from 'preact/hooks'
import type { Revision, RevisionDetail } from './api'

type Props = {
  // Where the revisions come from: a post or the profile of one language.
  loadList: () => Promise<Revision[]>
  loadOne: (revId: number) => Promise<RevisionDetail>
  current: string
  onRestore: (rev: RevisionDetail) => void
  onClose: () => void
}

export function History({ loadList, loadOne, current, onRestore, onClose }: Props) {
  const [list, setList] = useState<Revision[] | null>(null)
  const [picked, setPicked] = useState<RevisionDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadList().then(setList, (e: Error) => setError(e.message))
  }, [])

  async function open(rev: Revision) {
    setError('')
    try {
      setPicked(await loadOne(rev.id))
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
