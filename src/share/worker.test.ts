import { beforeEach, describe, expect, it } from 'vitest'
// Through Vite rather than off disk, so the test needs no Node types.
import stressPatchFile from '../../docs/stress-patch.txt?raw'
import { encodePatch } from '../state/patchCode'
import { defaultOscParams } from '../nodes/registry'
import { shortCodeFor } from '../state/shortCode'
import type { Patch } from '../types/patch'
import { MAX_PATCH_BYTES, adminGate, handle, isAdmin, type PatchStore, withinRate } from './worker'

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

describe('the publish rate limit', () => {
  const asking = (ip: string | null) => ({ headers: { get: () => ip } }) as unknown as Request

  const limiter = (allow: boolean) => ({
    calls: [] as string[],
    async limit(options: { key: string }) {
      this.calls.push(options.key)
      return { success: allow }
    },
  })

  it('allows everything when no limiter is bound', async () => {
    // A second line of defence, not the only one: an unbound limiter must not stop publishing.
    expect(await withinRate(asking('203.0.113.9'), undefined)).toBe(true)
  })

  it('allows the request when the edge did not say where it came from', async () => {
    expect(await withinRate(asking(null), limiter(false))).toBe(true)
  })

  it('refuses once the limiter says so', async () => {
    expect(await withinRate(asking('203.0.113.9'), limiter(false))).toBe(false)
  })

  it('allows while the limiter says so', async () => {
    expect(await withinRate(asking('203.0.113.9'), limiter(true))).toBe(true)
  })

  it('keys on a digest, never on the address itself', async () => {
    // The limiter holds its key for a minute; an address must not be the thing it holds.
    const bound = limiter(true)
    await withinRate(asking('203.0.113.9'), bound)
    expect(bound.calls[0]).not.toContain('203.0.113.9')
    expect(bound.calls[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives the same address the same key, or a limit would never bite', async () => {
    const bound = limiter(true)
    await withinRate(asking('203.0.113.9'), bound)
    await withinRate(asking('203.0.113.9'), bound)
    expect(bound.calls[0]).toBe(bound.calls[1])
  })
})

describe('the maintainer key', () => {
  const carrying = (header: string | null) =>
    ({ headers: { get: () => header } }) as unknown as Request

  it('is nobody when no key is configured', async () => {
    // A service without a secret set has no administrator rather than an open door.
    expect(await isAdmin(carrying('Bearer anything'), undefined)).toBe(false)
    expect(await isAdmin(carrying(null), '')).toBe(false)
  })

  it('accepts the key, with or without the Bearer word', async () => {
    expect(await isAdmin(carrying('Bearer s3cret'), 's3cret')).toBe(true)
    expect(await isAdmin(carrying('s3cret'), 's3cret')).toBe(true)
  })

  it('refuses anything else', async () => {
    expect(await isAdmin(carrying('Bearer wrong!'), 's3cret')).toBe(false)
    expect(await isAdmin(carrying('Bearer s3cre'), 's3cret')).toBe(false)
    expect(await isAdmin(carrying(null), 's3cret')).toBe(false)
  })
})

describe('presenting a key that does not match', () => {
  const carrying = (header: string | null) =>
    ({ headers: { get: () => header } }) as unknown as Request

  it('is told apart from presenting none at all', async () => {
    // The distinction the worker needs to answer 403 rather than 400: one is a refusal, the other is
    // an ordinary request that never claimed to be an administrator.
    expect(await isAdmin(carrying('Bearer nope'), 'real-key')).toBe(false)
    expect(await isAdmin(carrying(null), 'real-key')).toBe(false)
  })

  it('ignores surrounding whitespace, which a copied key often carries', async () => {
    expect(await isAdmin(carrying('Bearer   real-key  '), 'real-key')).toBe(true)
  })
})

describe('guessing the maintainer key', () => {
  const carrying = (header: string | null) =>
    ({
      headers: { get: (name: string) => (name === 'authorization' ? header : '198.51.100.7') },
    }) as unknown as Request

  const limiter = (allow: boolean) => ({
    calls: 0,
    async limit() {
      this.calls += 1
      return { success: allow }
    },
  })

  it('lets an ordinary request through untouched when no key is offered', async () => {
    const bound = limiter(true)
    const gate = await adminGate(carrying(null), 'real-key', bound)
    expect(gate).toEqual({ admin: false })
    // Nothing was spent: somebody withdrawing their own entry never claimed to be an administrator.
    expect(bound.calls).toBe(0)
  })

  it('spends nothing when the key is right', async () => {
    // The property that matters: an administrator cannot lock themselves out by working.
    const bound = limiter(true)
    const gate = await adminGate(carrying('Bearer real-key'), 'real-key', bound)
    expect(gate).toEqual({ admin: true })
    expect(bound.calls).toBe(0)
  })

  it('spends an attempt on a wrong key and refuses it', async () => {
    const bound = limiter(true)
    const gate = await adminGate(carrying('Bearer wrong'), 'real-key', bound)
    expect(gate).toEqual({ admin: false, refuse: 403 })
    expect(bound.calls).toBe(1)
  })

  it('stops answering once the guesses run out', async () => {
    // A wordlist against a short key is the whole threat, and this is what turns seconds into days.
    const gate = await adminGate(carrying('Bearer wrong'), 'real-key', limiter(false))
    expect(gate).toEqual({ admin: false, refuse: 429 })
  })

  it('still refuses when no key is configured, without spending anything', async () => {
    const bound = limiter(true)
    const gate = await adminGate(carrying('Bearer anything'), undefined, bound)
    expect(gate.admin).toBe(false)
    expect(gate.refuse).toBe(403)
  })

  it('does not reveal the key length by comparing lengths', async () => {
    // The comparison runs over two digests, which are always the same size, so a wrong guess of the
    // wrong length is refused for the same reason as any other wrong guess.
    expect(await isAdmin(carrying('Bearer x'), 'a-much-longer-key')).toBe(false)
    expect(await isAdmin(carrying('Bearer ' + 'x'.repeat(200)), 'a-much-longer-key')).toBe(false)
  })
})
