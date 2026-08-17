import type { Patch } from '../types/patch'

const KEY = 'castillon.patch.v1'

export function savePatch(patch: Patch): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(patch))
  } catch {
    // Quota full or storage blocked: not worth breaking the app over.
  }
}

export function loadStoredPatch(): Patch | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Patch
    if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) return null
    return parsed
  } catch {
    return null
  }
}
