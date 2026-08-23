import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toPatch, usePatchStore } from '../state/patchStore'
import { encodePatch } from '../state/patchCode'

/**
 * The field with no sharing service, which is how it runs locally and was never tested.
 *
 * `PatchCode.test.tsx` mocks `sharingAvailable` as true throughout, so every assertion in it is about
 * the configuration the deployed app has. The other branch decides whether the long code is on show at
 * all, whether GENERATE exists, and whether a six-character code is looked up or read as a patch — four
 * behaviours that only a checkout with no `VITE_SHARE_URL` ever sees, which is every checkout.
 */

vi.mock('../state/shareService', () => ({
  get sharingAvailable() {
    return false
  },
  publishPatch: async () => {
    throw new Error('sharing is not set up')
  },
  resolveShortCode: async () => {
    throw new Error('sharing is not set up')
  },
}))

const { PatchCode } = await import('./PatchCode')

const field = () => screen.getByLabelText('Patch code') as HTMLInputElement

beforeEach(() => {
  localStorage.clear()
  usePatchStore.getState().resetPatch()
})

describe('with no sharing service', () => {
  it('shows the long code, which is the only code that can work', () => {
    // No dev-mode run needed: a short code could never resolve for anybody here, so the long one is
    // not a developer's view of the field, it is the field.
    render(<PatchCode />)
    expect(field().value).toBe(encodePatch(toPatch()))
  })

  it('offers no GENERATE, since there is nothing to publish to', () => {
    render(<PatchCode />)
    expect(screen.queryByRole('button', { name: 'GENERATE' })).toBeNull()
  })

  it('takes a long code and loads it', () => {
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: encodePatch({ ...toPatch(), bpm: 77 }) } })
    expect(usePatchStore.getState().bpm).toBe(77)
  })

  it('loads a whole patch, not only the settings on the front of the code', () => {
    /*
     * The check worth having: bpm is the first field in the code and would survive almost any decoding
     * fault, so a test that only reads it back can pass while every node is lost.
     */
    render(<PatchCode />)
    const source = usePatchStore.getState()
    const before = { nodes: source.nodes.length, edges: source.edges.length }
    usePatchStore.getState().resetPatch()

    fireEvent.change(field(), { target: { value: encodePatch(toPatch()) } })
    const after = usePatchStore.getState()
    expect(after.nodes).toHaveLength(before.nodes)
    expect(after.edges).toHaveLength(before.edges)
  })

  it('reads a six-character code as a patch and says it is not one', () => {
    // With no service there is nothing to look one up against, so it must not sit there saying
    // "looking" for ever — it is simply not a code this build can use.
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'K7M2QX' } })
    expect(screen.getByText('not a patch code')).toBeDefined()
  })

  it('says so in words when a code does not read, not only in colour', () => {
    /*
     * This was the one status with no message. The field turned orange and said nothing, so a code
     * that had been wrapped in transit or written by an older build looked like a feature that does
     * not work rather than a code that does not read — which is exactly how it was reported.
     */
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'this is not a patch code at all' } })
    expect(screen.getByText('not a patch code')).toBeDefined()
    expect(field().className).toContain('invalid')
  })

  it('takes a long code that got wrapped on its way here', () => {
    const code = encodePatch({ ...toPatch(), bpm: 91 })
    render(<PatchCode />)
    // What a chat window or a text file does to three hundred characters of base64url.
    fireEvent.change(field(), { target: { value: `${code.slice(0, 60)}\n${code.slice(60)}` } })
    expect(usePatchStore.getState().bpm).toBe(91)
    expect(screen.queryByText('not a patch code')).toBeNull()
  })

  it('says nothing is wrong about an empty field', () => {
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: '' } })
    expect(screen.queryByText(/not a patch code/i)).toBeNull()
  })
})
