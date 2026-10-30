import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { api, ApiError, type EditableProfile, type ProfileLang, type RevisionDetail } from './api'
import { History } from './History'
import { LinksEditor } from './LinksEditor'
import { MarkdownPane } from './MarkdownPane'
import { render } from './render'
import { useUnsavedGuard } from './unsaved'

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/avif,image/gif'

type Meta = { headline?: string; location?: string; links?: EditableProfile['links']; badges?: EditableProfile['badges']; avatar_key?: string | null }

export function ProfileEditor() {
  const [lang, setLang] = useState<ProfileLang>('en')
  const [profile, setProfile] = useState<EditableProfile | null>(null)
  const [server, setServer] = useState<EditableProfile | null>(null)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // Which language the answer in flight belongs to: an answer for a tab the user already left is dropped.
  const wanted = useRef<ProfileLang>('en')
  const [pendingLang, setPendingLang] = useState<ProfileLang | null>(null)

  useEffect(() => {
    setProfile(null)
    setError('')
    setStatus('')
    setShowHistory(false)
    wanted.current = lang
    api.profile(lang).then(
      (p) => {
        if (wanted.current !== lang) return
        setProfile(p)
        setServer(p)
        setVersion((v) => v + 1)
      },
      (e: Error) => {
        if (wanted.current === lang) setError(e.message)
      },
    )
  }, [lang])

  const dirty = useMemo(() => !!profile && JSON.stringify(profile) !== JSON.stringify(server), [profile, server])
  useUnsavedGuard(dirty)
  const set = (patch: Partial<EditableProfile>) => setProfile((p) => (p ? { ...p, ...patch } : p))

  function switchTab(next: ProfileLang) {
    if (next === lang) return
    if (dirty) setPendingLang(next)
    else setLang(next)
  }

  async function save(next: EditableProfile) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const res = await api.saveProfile(next, render(next.body_md), 'save')
      const stamped = { ...next, revision: res.revision }
      setServer(stamped)
      setProfile((p) => (p ? { ...p, revision: res.revision } : p))
      setStatus(next.body_md.trim() ? 'Saved.' : 'Saved. The body is empty, so the home page does not use this profile.')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}. Reload the page to get the latest version.` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file || !profile) return
    setStatus('Uploading photo...')
    setError('')
    try {
      const bitmap = await createImageBitmap(file)
      const res = await api.upload(file, profile.name.trim() || 'Profile photo', bitmap.width, bitmap.height)
      set({ avatar_key: res.url.replace(/^\/media\//, '') })
      setStatus('Photo uploaded. Save to keep it.')
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`)
      setStatus('')
    }
  }

  function restore(rev: RevisionDetail) {
    const meta = JSON.parse(rev.meta_json ?? '{}') as Meta
    setProfile((p) =>
      p
        ? {
            ...p,
            name: rev.title,
            body_md: rev.body_md,
            headline: meta.headline ?? p.headline,
            location: meta.location ?? p.location,
            links: meta.links ?? p.links,
            badges: meta.badges ?? p.badges,
            avatar_key: meta.avatar_key === undefined ? p.avatar_key : meta.avatar_key,
          }
        : p,
    )
    setVersion((v) => v + 1)
    setShowHistory(false)
    setStatus(`Loaded revision ${rev.id}. Save to keep it.`)
  }

  return (
    <div class="editor">
      <div class="tabs show-always" role="tablist" aria-label="Profile language">
        {(['en', 'tr'] as const).map((l) => (
          <button type="button" role="tab" aria-selected={lang === l} disabled={busy || !profile} onClick={() => switchTab(l)}>
            {l === 'en' ? 'English' : 'Turkish'}
          </button>
        ))}
      </div>
      {pendingLang && (
        <div class="banner" role="alert">
          The {lang === 'en' ? 'English' : 'Turkish'} profile has unsaved changes. Switching to {pendingLang === 'en' ? 'English' : 'Turkish'} discards them.
          <button
            type="button"
            onClick={() => {
              setLang(pendingLang)
              setPendingLang(null)
            }}
          >
            Discard and switch
          </button>
          <button type="button" onClick={() => setPendingLang(null)}>
            Keep editing
          </button>
        </div>
      )}
      {!profile && <p>{error || 'Loading...'}</p>}
      {profile && (
        <>
          <p class="hint">
            The home page uses this profile only when its body is not empty. Without a Turkish profile, /tr shows the English one.
          </p>
          <form class="meta" onSubmit={(e) => e.preventDefault()}>
            <label>
              Name
              <input value={profile.name} onInput={(e) => set({ name: e.currentTarget.value })} required />
            </label>
            <label>
              Headline
              <input value={profile.headline} onInput={(e) => set({ headline: e.currentTarget.value })} />
            </label>
            <label>
              Location
              <input value={profile.location} onInput={(e) => set({ location: e.currentTarget.value })} />
            </label>
            <fieldset class="avatar-box">
              <legend>Photo</legend>
              {profile.avatar_key ? (
                <img class="avatar-preview" src={`/media/${profile.avatar_key}`} alt="Current profile photo" width={120} height={120} />
              ) : (
                <p class="hint">No photo.</p>
              )}
              <label class="upload">
                Upload a photo
                <input type="file" accept={IMAGE_TYPES} onChange={(e) => uploadAvatar(e.currentTarget.files?.[0])} />
              </label>
              {profile.avatar_key && (
                <div>
                  <button type="button" onClick={() => set({ avatar_key: null })}>
                    Remove photo
                  </button>
                </div>
              )}
            </fieldset>
            <LinksEditor legend="Links" items={profile.links} onChange={(links) => set({ links })} newItem={() => ({ label: '', url: '' })} />
            <LinksEditor legend="Badges" items={profile.badges} onChange={(badges) => set({ badges })} newItem={() => ({ label: '', url: '' })} />
          </form>
          <MarkdownPane value={profile.body_md} onChange={(body_md) => set({ body_md })} version={version} onStatus={setStatus} onError={setError} />
          <div class="actions">
            <p class="state" role="status" aria-live="polite">
              {error ? <span class="error">{error}</span> : status || (dirty ? 'Unsaved changes' : profile.revision ? 'Saved' : 'New')}
            </p>
            <button type="button" onClick={() => setShowHistory(!showHistory)} disabled={profile.revision === null}>
              History
            </button>
            <button type="button" class="primary" disabled={busy || !dirty || !profile.name.trim()} onClick={() => save(profile)}>
              Save
            </button>
          </div>
          {showHistory && (
            <History
              key={`${lang}-${profile.revision}`}
              loadList={() => api.profileRevisions(lang)}
              loadOne={(rev) => api.profileRevision(lang, rev)}
              current={profile.body_md}
              onRestore={restore}
              onClose={() => setShowHistory(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
