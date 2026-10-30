import type { Lang } from './db'
import { langPrefix, LOCALE } from './i18n'

const dateFmt = Object.fromEntries(
  (['en', 'tr'] as const).map((l) => [l, new Intl.DateTimeFormat(LOCALE[l], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })]),
) as Record<Lang, Intl.DateTimeFormat>

export function formatDate(iso: string, lang: Lang = 'en'): string {
  return dateFmt[lang].format(new Date(iso))
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function postPath(kind: 'writing' | 'note', slug: string, lang: Lang = 'en'): string {
  return langPrefix(lang) + (kind === 'note' ? `/notes/${slug}` : `/writing/${slug}`)
}
