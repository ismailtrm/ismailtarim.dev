import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useEffect, useRef } from 'preact/hooks'

type Props = {
  value: string
  onChange: (value: string) => void
  onFiles: (files: File[]) => void
  // Bumped by the parent when it replaces the text (restore, reload); typing does not bump it.
  version: number
  insertRef: { current: ((text: string) => void) | null }
}

export function MarkdownEditor({ value, onChange, onFiles, version, insertRef }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onFiles })
  latest.current = { onChange, onFiles }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          placeholder('Write in Markdown. Paste or drop an image to upload it.'),
          EditorView.contentAttributes.of({ 'aria-label': 'Post body (Markdown)', spellcheck: 'true' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            paste: (e) => takeFiles(e.clipboardData?.files, e),
            drop: (e) => takeFiles(e.dataTransfer?.files, e),
          }),
        ],
      }),
    })
    view.current = v
    insertRef.current = (text) => v.dispatch(v.state.replaceSelection(text))
    return () => {
      insertRef.current = null
      v.destroy()
    }
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [version])

  function takeFiles(list: FileList | undefined, e: Event): boolean {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return false
    e.preventDefault()
    latest.current.onFiles(files)
    return true
  }

  return <div class="md-editor" ref={host} />
}
