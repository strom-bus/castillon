import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toPatch, usePatchStore } from '../state/patchStore'
import { encodePatch } from '../state/patchCode'
import { shortCodeFor } from '../state/shortCode'

// The service is stubbed rather than reached: these tests are about what the field shows and when,
// and a real request would make them slow and flaky without testing anything more.
const publishPatch = vi.fn(async (code: string) => shortCodeFor(code))
const resolveShortCode = vi.fn(async (_id: string) => null as string | null)

vi.mock('../state/shareService', () => ({
  get sharingAvailable() {
    return true
  },
  publishPatch: (code: string) => publishPatch(code),
  resolveShortCode: (id: string) => resolveShortCode(id),
}))

const { PatchCode } = await import('./PatchCode')

function field(): HTMLInputElement {
  return screen.getByLabelText('Patch code') as HTMLInputElement
}

function clickCopy(times: number, gap = 0) {
  for (let i = 0; i < times; i++) {
    if (gap) vi.advanceTimersByTime(gap)
    fireEvent.click(screen.getByRole('button'))
  }
}

beforeEach(() => {
  localStorage.clear()
  publishPatch.mockClear()
  usePatchStore.getState().resetPatch()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what the field shows', () => {
  it('shows the short code, not the whole patch', () => {
    render(<PatchCode />)
    const expected = shortCodeFor(encodePatch(toPatch()))
    expect(field().value).toBe(expected)
    expect(field().value).toHaveLength(6)
  })

  it('follows the patch as it is edited', () => {
    render(<PatchCode />)
    const before = field().value

    act(() => usePatchStore.getState().setBpm(140))
    expect(field().value).not.toBe(before)
    expect(field().value).toBe(shortCodeFor(encodePatch(toPatch())))
  })

  it('marks a code nobody can resolve yet as such', () => {
    // Correct, but not yet published. Copy is what makes it reachable.
    render(<PatchCode />)
    expect(field().className).toContain('unpublished')
  })
})

describe('the developer mode', () => {
  it('five quick clicks bring the long code out', () => {
    render(<PatchCode />)
    expect(field().value).toHaveLength(6)

    clickCopy(5)
    expect(field().value).toBe(encodePatch(toPatch()))
    expect(field().value.length).toBeGreaterThan(50)
  })

  it('and five more put it away again', () => {
    render(<PatchCode />)
    clickCopy(5)
    clickCopy(5)
    expect(field().value).toHaveLength(6)
  })

  it('clicking slowly just copies', () => {
    vi.useFakeTimers()
    render(<PatchCode />)
    // Spread out past the window, so an ordinary run of copies cannot trip it.
    clickCopy(5, 2000)
    expect(field().value).toHaveLength(6)
  })

  it('says so, so the mode is never a mystery', () => {
    render(<PatchCode />)
    expect(screen.getByText('CODE')).toBeDefined()
    clickCopy(5)
    expect(screen.getByText('PATCH CODE · DEV')).toBeDefined()
  })

  it('survives a reload, since it is for working not for showing off', () => {
    const first = render(<PatchCode />)
    clickCopy(5)
    first.unmount()

    render(<PatchCode />)
    expect(field().value).toBe(encodePatch(toPatch()))
  })

  it('copies the long code rather than publishing anything', async () => {
    render(<PatchCode />)
    clickCopy(5)
    publishPatch.mockClear()
    clickCopy(1)
    expect(publishPatch).not.toHaveBeenCalled()
  })
})

describe('copying', () => {
  it('publishes before copying, so what lands on the clipboard works', async () => {
    render(<PatchCode />)
    clickCopy(1)
    await vi.waitFor(() => expect(publishPatch).toHaveBeenCalledWith(encodePatch(toPatch())))
  })

  it('does not publish the same patch twice', async () => {
    render(<PatchCode />)
    clickCopy(1)
    await vi.waitFor(() => expect(publishPatch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(field().className).not.toContain('unpublished'))

    clickCopy(1)
    expect(publishPatch).toHaveBeenCalledTimes(1)
  })
})

describe('pasting', () => {
  it('still takes a long code, which is how a patch travels without a service', () => {
    render(<PatchCode />)
    const other = { ...toPatch(), bpm: 77 }
    fireEvent.change(field(), { target: { value: encodePatch(other) } })
    expect(usePatchStore.getState().bpm).toBe(77)
  })

  it('looks up a short code', async () => {
    const target = encodePatch({ ...toPatch(), bpm: 99 })
    resolveShortCode.mockResolvedValueOnce(target)

    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'K7M2QX' } })
    await vi.waitFor(() => expect(usePatchStore.getState().bpm).toBe(99))
  })

  it('says when there is nothing under a code', async () => {
    resolveShortCode.mockResolvedValueOnce(null)
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'K7M2QX' } })
    await vi.waitFor(() => expect(screen.getByText('no such code')).toBeDefined())
  })
})
