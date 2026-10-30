import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { api, type Kind, type PostSummary } from './api'
import { Editor } from './Editor'
import { Stats } from './Stats'

// Hash routes keep every panel URL on the one static index.html: #/, #/new/note, #/edit/12
type Route = { name: 'list' } | { name: 'stats' } | { name: 'new'; kind: Kind } | { name: 'edit'; id: number }

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/')
  if (a === 'new' && (b === 'note' || b === 'writing')) return { name: 'new', kind: b }
  if (a === 'stats') return { name: 'stats' }
  if (a === 'edit' && b && /^\d+$/.test(b)) return { name: 'edit', id: Number(b) }
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
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  return (
    <>
      <header class="site-header">
        <a class="wordmark" href="#/">
          <span class="accent">~/</span>admin
        </a>
        <nav aria-label="Admin">
          <a href="#/">Posts</a>
          <a href="#/stats">Stats</a>
          <a href="/" target="_blank" rel="noopener">
            View site
          </a>
        </nav>
      </header>
      <main class="admin-main">
        {route.name === 'list' && <PostList />}
        {route.name === 'stats' && <Stats />}
        {route.name === 'new' && <Editor key={`new-${route.kind}`} id={null} kind={route.kind} onSaved={(id) => location.replace(`#/edit/${id}`)} />}
        {route.name === 'edit' && <Editor key={`edit-${route.id}`} id={route.id} kind="note" onSaved={() => undefined} />}
      </main>
    </>
  )
}

render(<App />, document.getElementById('app')!)
