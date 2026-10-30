import type { HomeProfile, Lang } from './db'

// What the two home pages are, derived once from which languages have a profile with a body.
// A language without one shows the old home (English) or borrows the English profile (Turkish).
export type HomeState = {
  // hreflang links between the homes: only when both have their own profile, or neither does (both old homes).
  paired: boolean
  // /tr is indexable and in the sitemap when it has its own profile, or when neither language has one.
  trIndexable: boolean
}

export const LEGACY_HOME: HomeState = { paired: true, trIndexable: true }

export function homeState(profiles: Partial<Record<Lang, HomeProfile>>): HomeState {
  const en = !!profiles.en
  const tr = !!profiles.tr
  return { paired: en === tr, trIndexable: tr || !en }
}
