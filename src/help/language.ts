/**
 * Which language the manual is in.
 *
 * **Only the manual.** The interface stays in English: its labels are three words each and technical,
 * and translating `DIV` or `REPS` would make them longer without making them clearer. Prose is the part
 * that needs a language, so prose is the part that has one.
 *
 * Chosen from the browser's own locale on the first visit and remembered after that, so nobody has to
 * find a switch to read their own language — the same courtesy the gallery already extends when it
 * guesses a country.
 */
import { create } from 'zustand'

export type Language = 'en' | 'es'

export const LANGUAGES: readonly Language[] = ['en', 'es']

/** In each language's own name, since a person looking for Spanish is looking for "Español". */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  es: 'Español',
}

const KEY = 'castillon.manual.language'

export function preferredLanguage(): Language {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Storage blocked. The locale is a better guess than English regardless.
  }
  // `navigator.language` is a tag like `es-419`, so the region is dropped.
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('es') ? 'es' : 'en'
}

export const useLanguage = create<{
  language: Language
  set(language: Language): void
}>((set) => ({
  language: preferredLanguage(),
  set: (language) => {
    try {
      localStorage.setItem(KEY, language)
    } catch {
      // Not worth breaking a manual over.
    }
    set({ language })
  },
}))
