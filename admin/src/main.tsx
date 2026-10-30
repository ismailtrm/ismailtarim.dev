import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type Kind, type PostSummary } from './api'
import { AchievementEditor, AchievementList } from './Awards'
import { Editor } from './Editor'
import { ProfileEditor } from './ProfileEditor'
import { ProjectEditor, ProjectList } from './Projects'
import { Stats } from './Stats'
import { clearUnsaved, hasUnsaved } from './unsaved'

// Hash routes keep every panel URL on the one static index.html: #/, #/new/note, #/edit/12, #/translate/12, #/profile, #/projects, #/projects/new, #/projects/3, #/awards, #/awards/new, #/awards/4
type Route =
  | { name: 'list' }
  | { name: 'stats' }
  | { name: 'profile' }
  | { name: 'projects' }
  | { name: 'project'; id: number | null }
  | { name: 'awards' }
  | { name: 'award'; id: number | null }
  | { name: 'new'; kind: Kind } | { name: 'edit'; id: number } | { name: 'translate'; id: number }

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/')
  if (a === 'new' && (b === 'note' || b === 'writing')) return { name: 'new', kind: b }
  if (a === 'stats') return { name: 'stats' }
  if (a === 'profile') return { name: 'profile' }
  if (a === 'projects' && b === 'new') return { name: 'project', id: null }
  if (a === 'projects' && b && /^\d+$/.test(b)) return { name: 'project', id: Number(b) }
  if (a === 'projects') return { name: 'projects' }
  if (a === 'awards' && b === 'new') return { name: 'award', id: null }
  if (a === 'awards' && b && /^\d+$/.test(b)) return { name: 'award', id: Number(b) }
  if (a === 'awards') return { name: 'awards' }
  if (a === 'edit' && b && /^\d+$/.test(b)) return { name: 'edit', id: Number(b) }
  if (a === 'translate' && b && /^\d+$/.test(b)) return { name: 'translate', id: Number(b) }
  return { name: 'list' }
}

function PostList() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.list().then(setPosts, (e: Error) => setError(e.message))
  }, [])

  return (
    <section>
      <div class="list-actions">
        <a class="button primary" href="#/new/note">
          New note
        </a>
        <a class="button" href="#/new/writing">
          New essay
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {!posts && !error && <p>Loading posts...</p>}
      {posts && posts.length === 0 && <p>No posts yet. Start with a note: one problem, its symptom and the fix.</p>}
      {posts && posts.length > 0 && (
        <table class="post-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Kind</th>
              <th scope="col">Lang</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`#/edit/${p.id}`}>{p.title}</a>
                </td>
                <td>{p.kind === 'note' ? 'Note' : 'Writing'}</td>
                <td>{p.lang.toUpperCase()}</td>
                <td>{p.status}</td>
                <td>
                  <time>{p.updated_at.slice(0, 10)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function App() {
  const [route, setRoute] = useState(() => parse(location.hash))
  // A hash change has already happened when it is reported, so leaving unsaved work means putting the old hash back.
  const [pendingHash, setPendingHash] = useState<string | null>(null)
  const currentHash = useRef(location.hash)
  useEffect(() => {
    const onHash = () => {
      if (hasUnsaved()) {
        setPendingHash(location.hash)
        history.replaceState(null, '', currentHash.current || '#/')
        return
      }
      currentHash.current = location.hash
      setPendingHash(null)
      setRoute(parse(location.hash))
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  function leave() {
    clearUnsaved()
    location.hash = pendingHash ?? '#/'
  }

  return (
    <>
      <header class="site-header">
        <a class="wordmark" href="#/">
          <span class="accent">~/</span>admin
        </a>
        <nav aria-label="Admin">
          <a href="#/">Posts</a>
          <a href="#/profile">Profile</a>
          <a href="#/projects">Projects</a>
          <a href="#/awards">Awards</a>
          <a href="#/stats">Stats</a>
          <a href="/" target="_blank" rel="noopener">
            View site
          </a>
        </nav>
      </header>
      <main class="admin-main">
        {pendingHash !== null && (
          <div class="banner" role="alert">
            You have unsaved changes.
            <button type="button" onClick={leave}>
              Leave without saving
            </button>
            <button type="button" onClick={() => setPendingHash(null)}>
              Stay
            </button>
          </div>
        )}
        {route.name === 'list' && <PostList />}
        {route.name === 'stats' && <Stats />}
        {route.name === 'profile' && <ProfileEditor />}
        {route.name === 'projects' && <ProjectList />}
        {route.name === 'project' && <ProjectEditor key={`project-${route.id}`} id={route.id} />}
        {route.name === 'awards' && <AchievementList />}
        {route.name === 'award' && <AchievementEditor key={`award-${route.id}`} id={route.id} />}
        {route.name === 'new' && <Editor key={`new-${route.kind}`} id={null} kind={route.kind} onSaved={(id) => location.replace(`#/edit/${id}`)} />}
        {route.name === 'translate' && (
          <Editor key={`translate-${route.id}`} id={null} kind="note" translateOf={route.id} onSaved={(id) => location.replace(`#/edit/${id}`)} />
        )}
        {route.name === 'edit' && <Editor key={`edit-${route.id}`} id={route.id} kind="note" onSaved={() => undefined} />}
      </main>
    </>
  )
}

render(<App />, document.getElementById('app')!)
