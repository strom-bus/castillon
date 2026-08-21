import { describe, expect, it } from 'vitest'
import type { Patch, PatchNode, StartParams } from '../types/patch'
import { ignitesFor, press, release, type Firing } from './triggers'

/**
 * The mapping from a press to what an Ignite does, tested without a keyboard and without a scheduler
 * — which is the point of the abstraction (PLAN §17.3). If these pass with a fake source and a fake
 * scheduler, MIDI is a second caller and not a second implementation.
 */

function ignite(id: string, params: StartParams): PatchNode {
  return { id, type: 'start', position: { x: 0, y: 0 }, params }
}

function patchOf(nodes: PatchNode[]): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges: [] }
}

/** A scheduler that only remembers what it was told. */
function recorder(): Firing & { fired: string[]; released: string[]; sounding: Set<string> } {
  const sounding = new Set<string>()
  return {
    fired: [],
    released: [],
    sounding,
    fire(id) {
      this.fired.push(id)
      sounding.add(id)
    },
    release(id) {
      this.released.push(id)
      sounding.delete(id)
    },
    isFiring(id) {
      return sounding.has(id)
    },
  }
}

const KEY_A = 'key:KeyA'
const held = (id: string): PatchNode =>
  ignite(id, { trigger: 'bound', behaviour: 'hold', binding: { source: 'key', code: 'KeyA' } })
const toggled = (id: string): PatchNode =>
  ignite(id, { trigger: 'bound', behaviour: 'toggle', binding: { source: 'key', code: 'KeyA' } })

describe('ignitesFor', () => {
  it('finds the bound Ignites answering to an identity', () => {
    const patch = patchOf([held('a'), ignite('auto', {})])
    expect(ignitesFor(patch, KEY_A).map((n) => n.id)).toEqual(['a'])
  })

  it('finds every one of them, since a key may launch several cascades', () => {
    const patch = patchOf([held('a'), held('b')])
    expect(ignitesFor(patch, KEY_A)).toHaveLength(2)
  })

  it('ignores an Ignite bound to another key', () => {
    const other = ignite('b', {
      trigger: 'bound',
      behaviour: 'hold',
      binding: { source: 'key', code: 'KeyB' },
    })
    expect(ignitesFor(patchOf([other]), KEY_A)).toHaveLength(0)
  })

  it('ignores an automatic Ignite even if it somehow carries a binding', () => {
    // Switching back to auto should not leave a key still live.
    const stale = ignite('a', {
      trigger: 'auto',
      behaviour: 'hold',
      binding: { source: 'key', code: 'KeyA' },
    })
    expect(ignitesFor(patchOf([stale]), KEY_A)).toHaveLength(0)
  })

  it('would find a MIDI binding by the same rule, with nothing here knowing what MIDI is', () => {
    const byNote = ignite('m', {
      trigger: 'bound',
      behaviour: 'hold',
      binding: { source: 'midi', code: '60' },
    })
    expect(ignitesFor(patchOf([byNote]), 'midi:60').map((n) => n.id)).toEqual(['m'])
  })
})

describe('hold', () => {
  it('fires on the press and stops on the release', () => {
    const firing = recorder()
    const patch = patchOf([held('a')])

    press(patch, KEY_A, firing)
    expect(firing.fired).toEqual(['a'])

    release(patch, KEY_A, firing)
    expect(firing.released).toEqual(['a'])
  })

  it('fires every Ignite on that key', () => {
    const firing = recorder()
    press(patchOf([held('a'), held('b')]), KEY_A, firing)
    expect(firing.fired).toEqual(['a', 'b'])
  })
})

describe('toggle', () => {
  it('starts on the first press and stops on the second', () => {
    const firing = recorder()
    const patch = patchOf([toggled('a')])

    press(patch, KEY_A, firing)
    expect(firing.fired).toEqual(['a'])

    press(patch, KEY_A, firing)
    expect(firing.released).toEqual(['a'])
  })

  it('ignores the release, since it is waiting for the next press', () => {
    const firing = recorder()
    const patch = patchOf([toggled('a')])

    press(patch, KEY_A, firing)
    release(patch, KEY_A, firing)
    expect(firing.released).toEqual([])
  })

  it('starts again on a third press', () => {
    const firing = recorder()
    const patch = patchOf([toggled('a')])
    press(patch, KEY_A, firing)
    press(patch, KEY_A, firing)
    press(patch, KEY_A, firing)
    expect(firing.fired).toEqual(['a', 'a'])
  })

  it('sits beside a held Ignite on the same key without either confusing the other', () => {
    const firing = recorder()
    const patch = patchOf([held('h'), toggled('t')])

    press(patch, KEY_A, firing)
    expect(firing.fired).toEqual(['h', 't'])

    release(patch, KEY_A, firing)
    // The held one stops, the toggled one keeps going until its next press.
    expect(firing.released).toEqual(['h'])
    expect(firing.isFiring('t')).toBe(true)
  })
})
