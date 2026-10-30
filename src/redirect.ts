// The schema already restricts redirects to same-site paths; this repeats the check at the
// point of use because a wrong 301 is cached by browsers for a very long time.
export function safeRedirectTarget(from: string, to: string | null): string | null {
  if (!to || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\') || to === from) return null
  return to
}

export function isSafeHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://')
}
