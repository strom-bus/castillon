import { beforeEach, describe, expect, it } from 'vitest'
// Through Vite rather than off disk, so the test needs no Node types.
import stressPatchFile from '../../docs/stress-patch.txt?raw'
import { encodePatch } from '../state/patchCode'
import { defaultOscParams } from '../nodes/registry'
import { shortCodeFor } from '../state/shortCode'
import type { Patch } from '../types/patch'
import { handle, MAX_PATCH_BYTES, type PatchStore } from './worker'

/** Stands in for KV. The logic never knows the difference, which is why it is an interface. */
function memoryStore(): PatchStore & { size(): number } {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async put(key, value) {
      map.set(key, value)
    },
    size: () => map.size,
  }
}

function patchOf(seed: number): Patch {
  return {
    version: 1,
    bpm: 120,
    loop: true,
    nodes: [
      {
        id: 'a',
        type: 'osc',
        position: { x: seed * 4, y: 0 },
        params: defaultOscParams(),
      },
    ],
    edges: [],
  }
}

const post = (body: string) => new Request('https://share.test/', { method: 'POST', body })
const get = (path: string) => new Request(`https://share.test/${path}`)

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
})

describe('publishing', () => {
  it('answers with a six-character code', async () => {
    const response = await handle(post(encodePatch(patchOf(1))), store)
    expect(response.status).toBe(200)
    expect(await response.text()).toHaveLength(6)
  })

  it('answers the same code for the same patch, and stores it once', async () => {
    // The key is derived from the content, so sharing twice cannot create a second entry.
    const code = encodePatch(patchOf(1))
    const first = await (await handle(post(code), store)).text()
    const second = await (await handle(post(code), store)).text()

    expect(second).toBe(first)
    expect(store.size()).toBe(1)
  })

  it('answers a different code for a different patch', async () => {
    const one = await (await handle(post(encodePatch(patchOf(1))), store)).text()
    const two = await (await handle(post(encodePatch(patchOf(2))), store)).text()
    expect(one).not.toBe(two)
  })

  it('settles a collision by extending rather than overwriting', async () => {
    // Forced: something else already sits on the code this patch would take.
    const code = encodePatch(patchOf(7))
    await store.put(shortCodeFor(code, 6), 'someone-elses-patch')

    const answer = await (await handle(post(code), store)).text()
    expect(answer).toHaveLength(7)
    // And the longer code still begins with the shorter one, so nothing already seen is orphaned.
    expect(answer.startsWith(shortCodeFor(code, 6))).toBe(true)
    // Whatever was there is untouched.
    await expect(store.get(shortCodeFor(code, 6))).resolves.toBe('someone-elses-patch')
  })

  it('refuses anything that is not a patch', async () => {
    // Without this the service is free hosting for arbitrary text, which is what attracts abuse.
    for (const body of ['', 'hello world', 'AAAA', 'not a code at all']) {
      const response = await handle(post(body), store)
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    expect(store.size()).toBe(0)
  })

  it('refuses a payload with characters a patch code cannot contain', async () => {
    const response = await handle(post('!!!!!!!!!!!!'), store)
    expect(response.status).toBe(400)
  })

  it('refuses an oversized payload before trying to decode it', async () => {
    const response = await handle(post('A'.repeat(MAX_PATCH_BYTES + 1)), store)
    expect(response.status).toBe(413)
    expect(store.size()).toBe(0)
  })

  it('accepts the real load-test patch, which is the largest thing we make', async () => {
    const stress = stressPatchFile
      .trim()
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => /^[A-Za-z0-9_-]{200,}$/.test(line))
      .at(-1) as string

    const response = await handle(post(stress), store)
    expect(response.status).toBe(200)
    expect(stress.length).toBeLessThan(MAX_PATCH_BYTES)
  })
})

describe('resolving', () => {
  it('gives back exactly what was published', async () => {
    const code = encodePatch(patchOf(3))
    const id = await (await handle(post(code), store)).text()

    const response = await handle(get(id), store)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(code)
  })

  it('reads a code the way a person would have typed it', async () => {
    const code = encodePatch(patchOf(4))
    const id = await (await handle(post(code), store)).text()

    // Lower case, and with the letters Crockford leaves out written where the digits belong.
    const mistyped = id.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')
    expect(await (await handle(get(mistyped), store)).text()).toBe(code)
  })

  it('says so when there is nothing there', async () => {
    expect((await handle(get('K7M2QX'), store)).status).toBe(404)
  })

  it('does not treat a long path as a code', async () => {
    expect((await handle(get('A'.repeat(40)), store)).status).toBe(404)
  })

  it('answers a bare request without looking anything up', async () => {
    expect((await handle(get(''), store)).status).toBe(200)
  })
})

describe('the browser calling it', () => {
  it('allows a cross-origin request, since the app is served from elsewhere', async () => {
    const response = await handle(get(''), store)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('answers a preflight', async () => {
    const response = await handle(new Request('https://share.test/', { method: 'OPTIONS' }), store)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('refuses a method it does not serve', async () => {
    const response = await handle(new Request('https://share.test/', { method: 'DELETE' }), store)
    expect(response.status).toBe(405)
  })
})
