const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function postPath(kind: 'writing' | 'note', slug: string): string {
  return kind === 'note' ? `/notes/${slug}` : `/writing/${slug}`
}
