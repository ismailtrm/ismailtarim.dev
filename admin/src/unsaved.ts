import { useEffect } from 'preact/hooks'

// One editor is open at a time, so one flag is enough. The router asks it before leaving a route.
let dirty = false

export const hasUnsaved = () => dirty

// Called right before an editor navigates by itself, since its state update has not rendered yet.
export function clearUnsaved() {
  dirty = false
}

function warnOnUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
}

export function useUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    dirty = isDirty
    if (!isDirty) return
    addEventListener('beforeunload', warnOnUnload)
    return () => {
      removeEventListener('beforeunload', warnOnUnload)
      dirty = false
    }
  }, [isDirty])
}
