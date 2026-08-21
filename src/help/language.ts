/**
 * Which language the manual is in.
 *
 * **Only the manual.** The interface stays in English: its labels are three words each and technical,
 * and translating `DIV` or `REPS` would make them longer without making them clearer. Prose is the part
 * that needs a language, so prose is the part that has one.
 *
 * English by default, and remembered once somebody chooses otherwise. Guessing from the browser's
 * locale was the first version and it is the wrong default here: the interface around the manual is in
 * English, so a manual that opens in another language leaves somebody reading two at once.
 */
import { create } from 'zustand'

export type Language = 'en' | 'es'

export const LANGUAGES: readonly Language[] = ['en', 'es']

/** Short, because the switch is a toggle in a header and not a menu. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'EN',
  es: 'ESP',
}

const KEY = 'castillon.manual.language'

export function preferredLanguage(): Language {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Storage blocked, which is no reason to open in a different language than usual.
  }
  return 'en'
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
