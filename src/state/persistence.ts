import type { Patch } from '../types/patch'

const KEY = 'castillon.patch.v1'

export function savePatch(patch: Patch): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(patch))
  } catch {
    // Cuota llena o almacenamiento bloqueado: no vale la pena romper la app por esto.
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

export function exportPatch(patch: Patch): void {
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'castillon-patch.json'
  link.click()
  URL.revokeObjectURL(url)
}

export function importPatch(): Promise<Patch | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        const parsed = JSON.parse(await file.text()) as Patch
        resolve(parsed.version === 1 ? parsed : null)
      } catch {
        resolve(null)
      }
    }
    input.click()
  })
}
