import type { Lang } from './db'

// English lives at the root, Turkish under /tr; a post keeps the same slug in both.
export function langPrefix(lang: Lang): string {
  return lang === 'tr' ? '/tr' : ''
}

export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'tr' : 'en'
}

export function homePath(lang: Lang): string {
  return langPrefix(lang) || '/'
}

export const LOCALE: Record<Lang, string> = { en: 'en-GB', tr: 'tr-TR' }

// Fixed interface strings only; post content is never translated here.
export const UI = {
  en: {
    tagline: 'Backend and AI systems engineer in İzmir.',
    intro: 'Backend and AI systems engineer in İzmir. Field notes, projects and essays.',
    feedDescription: 'Field notes, projects and essays.',
    llmsDescription: 'Backend and AI systems engineer. Field notes on problems that are not documented elsewhere, projects and essays.',
    languageName: 'English',
    home: 'Home',
    mainNav: 'Main',
    writing: 'Writing',
    notes: 'Notes',
    projects: 'Projects',
    awards: 'Awards',
    awardsHeading: 'Awards and contributions',
    contributions: 'Contributions',
    noAwards: 'No awards or contributions listed yet.',
    recent: 'Recent',
    selectedProjects: 'Selected projects',
    switchTheme: 'Switch color theme',
    noPosts: 'Nothing published here yet.',
    noProjects: 'No projects listed yet.',
    work: 'Work',
    year: 'Year',
    status: 'Status',
    evidence: 'Evidence',
    statusLabel: {
      merged: 'merged',
      under_review: 'under review',
      submitted: 'submitted',
      published: 'published',
      personal: 'personal tool',
    },
    fieldNote: 'Field note',
    essay: 'Writing',
    shortAnswer: 'Short answer',
    symptom: 'Symptom:',
    fix: 'Fix:',
    verified: 'verified',
    notFoundTitle: 'Not found',
    notFoundBefore: 'This page does not exist. Try ',
    notFoundOr: ' or ',
    notFoundAfter: '.',
    errorTitle: 'Error',
    errorHeading: 'Something broke',
    errorBody: 'The page could not be loaded. Try again in a minute.',
  },
  tr: {
    tagline: 'İzmir’de backend ve yapay zekâ sistemleri mühendisi.',
    intro: 'İzmir’de backend ve yapay zekâ sistemleri mühendisi. Saha notları, projeler ve yazılar.',
    feedDescription: 'Saha notları, projeler ve yazılar.',
    llmsDescription: 'Backend ve yapay zekâ sistemleri mühendisi. Başka yerde belgelenmemiş sorunlara saha notları, projeler ve yazılar.',
    languageName: 'Türkçe',
    home: 'Ana sayfa',
    mainNav: 'Ana gezinme',
    writing: 'Yazılar',
    notes: 'Notlar',
    projects: 'Projeler',
    awards: 'Ödüller',
    awardsHeading: 'Ödüller ve katkılar',
    contributions: 'Katkılar',
    noAwards: 'Henüz listelenmiş ödül veya katkı yok.',
    recent: 'Son yazılar',
    selectedProjects: 'Seçili projeler',
    switchTheme: 'Renk temasını değiştir',
    noPosts: 'Burada henüz yayımlanmış bir şey yok.',
    noProjects: 'Henüz listelenmiş proje yok.',
    work: 'Çalışma',
    year: 'Yıl',
    status: 'Durum',
    evidence: 'Kanıt',
    statusLabel: {
      merged: 'kabul edildi',
      under_review: 'incelemede',
      submitted: 'gönderildi',
      published: 'yayımlandı',
      personal: 'kişisel araç',
    },
    fieldNote: 'Saha notu',
    essay: 'Yazı',
    shortAnswer: 'Kısa cevap',
    symptom: 'Belirti:',
    fix: 'Çözüm:',
    verified: 'doğrulandı',
    notFoundTitle: 'Sayfa bulunamadı',
    notFoundBefore: 'Bu sayfa yok. ',
    notFoundOr: ' veya ',
    notFoundAfter: ' sayfalarına bakabilirsiniz.',
    errorTitle: 'Hata',
    errorHeading: 'Bir şeyler bozuldu',
    errorBody: 'Sayfa yüklenemedi. Bir dakika sonra tekrar deneyin.',
  },
} as const
