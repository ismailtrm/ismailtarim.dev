import { useEffect, useRef, useState } from 'preact/hooks'
import { MarkdownEditor } from './MarkdownEditor'
import { render } from './render'
import { uploadImages } from './uploads'

type Props = {
  value: string
  onChange: (value: string) => void
  // Bumped by the parent when it replaces the text (restore, reload).
  version: number
  // Shown above the rendered preview, like the post's title.
  title?: string
  onStatus: (message: string) => void
  onError: (message: string) => void
}

// The Write/Preview toggle, the editor with image paste and drop, and the Add image button.
export function MarkdownPane({ value, onChange, version, title, onStatus, onError }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [preview, setPreview] = useState('')
  const insertRef = useRef<((text: string) => void) | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setPreview(render(value))
      } catch (e) {
        setPreview(`<p>Preview failed: ${(e as Error).message}</p>`)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [value])

  const upload = (files: File[]) => uploadImages(files, insertRef.current, onStatus, onError)

  return (
    <>
      <div class="tabs" role="tablist" aria-label="Editor view">
        <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      <div class={`panes show-${tab}`}>
        <div class="pane write">
          <MarkdownEditor value={value} onChange={onChange} onFiles={upload} version={version} insertRef={insertRef} />
          <label class="upload">
            Add image
            <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(e) => upload(Array.from(e.currentTarget.files ?? []))} />
          </label>
        </div>
        <article class="pane preview prose" aria-label="Preview">
          {title !== undefined && <h1>{title || 'Untitled'}</h1>}
          <div dangerouslySetInnerHTML={{ __html: preview }} />
        </article>
      </div>
    </>
  )
}
