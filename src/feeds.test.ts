import { describe, expect, it } from 'vitest'
import type { PostListItem } from './db'
import { llmsTxt, rss } from './feeds'

const note: PostListItem = {
  kind: 'note',
  slug: 'tmux-hex-colors',
  title: 'tmux clamps 24-bit colors <256> & more',
  summary: null,
  lang: 'en',
  published_at: '2026-10-14T09:00:00Z',
}

describe('rss', () => {
  it('escapes titles so a < or & in a note title cannot break the feed', () => {
    const xml = rss('https://ismailtarim.dev', 'İsmail Tarım', [note])
    expect(xml).toContain('clamps 24-bit colors &lt;256&gt; &amp; more')
    expect(xml).not.toContain('<256>')
  })

  it('links notes under /notes and writing under /writing', () => {
    const xml = rss('https://ismailtarim.dev', 'x', [note, { ...note, kind: 'writing', slug: 'curiosity' }])
    expect(xml).toContain('<link>https://ismailtarim.dev/notes/tmux-hex-colors</link>')
    expect(xml).toContain('<link>https://ismailtarim.dev/writing/curiosity</link>')
  })
})

describe('llmsTxt', () => {
  it('lists notes and writing in separate sections and skips empty ones', () => {
    const txt = llmsTxt('https://ismailtarim.dev', 'İsmail Tarım', [note])
    expect(txt).toContain('## Notes')
    expect(txt).not.toContain('## Writing')
  })
})
