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

beforeEach(() => {
  localStorage.clear()
  publishPatch.mockClear()
  usePatchStore.getState().resetPatch()
})

afterEach(() => {
  vi.useRealTimers()
})

const generate = () => fireEvent.click(screen.getByRole('button', { name: 'GENERATE' }))
const copy = () => fireEvent.click(screen.getByText(/COPY|COPIED/))

function clickCopyRun(times: number, gap = 0) {
  for (let i = 0; i < times; i++) {
    if (gap) vi.advanceTimersByTime(gap)
    copy()
  }
}

describe('what the field shows', () => {
  it('is empty until a code has actually been generated', () => {
    // The failure this avoids: a code shown before it exists is a code somebody writes down on
    // paper, and dimming it is not enough to stop that.
    render(<PatchCode />)
    expect(field().value).toBe('')
    expect(field().placeholder).toContain('generate')
  })

  it('shows the code once it has', async () => {
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(field().value).toBe(shortCodeFor(encodePatch(toPatch()))))
    expect(field().value).toHaveLength(6)
  })

  it('empties again when the patch is edited, rather than describing an older one', async () => {
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(field().value).not.toBe(''))

    act(() => usePatchStore.getState().setBpm(140))
    expect(field().value).toBe('')
  })

  it('comes back on returning to a patch already generated', async () => {
    // The code comes from the content, so it cannot have changed while you were away, and asking
    // the service for it a second time would be pointless.
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(field().value).not.toBe(''))
    const first = field().value

    act(() => usePatchStore.getState().setBpm(140))
    act(() => usePatchStore.getState().setBpm(300))
    expect(field().value).toBe(first)
  })
})

describe('generating', () => {
  it('is the only thing that publishes', async () => {
    render(<PatchCode />)
    copy()
    copy()
    expect(publishPatch).not.toHaveBeenCalled()

    generate()
    await vi.waitFor(() => expect(publishPatch).toHaveBeenCalledTimes(1))
  })

  it('will not publish the same patch twice', async () => {
    render(<PatchCode />)
    generate()
    // Waiting for the button rather than the call: the request having been made is not the same as
    // the component having taken it in, and clicking between the two would publish twice.
    await vi.waitFor(() => expect(screen.getByText('GENERATED')).toBeDefined())

    fireEvent.click(screen.getByText('GENERATED'))
    expect(publishPatch).toHaveBeenCalledTimes(1)
  })

  it('says when it has already been done', async () => {
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(screen.getByText('GENERATED')).toBeDefined())
  })

  it('reports a service it cannot reach instead of pretending', async () => {
    publishPatch.mockRejectedValueOnce(new Error('down'))
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(screen.getByText(/unreachable/)).toBeDefined())
    expect(field().value).toBe('')
  })
})

describe('copying', () => {
  it('copies what is in the field and asks for nothing', async () => {
    render(<PatchCode />)
    generate()
    await vi.waitFor(() => expect(field().value).not.toBe(''))
    const code = field().value
    publishPatch.mockClear()

    copy()
    await vi.waitFor(() => expect(screen.getByText('COPIED')).toBeDefined())
    // Copying twice gives the same code and creates nothing, which is the point of the split.
    copy()
    expect(publishPatch).not.toHaveBeenCalled()
    expect(field().value).toBe(code)
  })

  it('does nothing with an empty field', () => {
    render(<PatchCode />)
    copy()
    expect(screen.queryByText('COPIED')).toBeNull()
  })
})

describe('the developer mode', () => {
  it('five quick clicks bring the long code out, generating nothing', () => {
    render(<PatchCode />)
    clickCopyRun(5)
    expect(field().value).toBe(encodePatch(toPatch()))
    expect(publishPatch).not.toHaveBeenCalled()
  })

  it('and five more put it away again', () => {
    render(<PatchCode />)
    clickCopyRun(5)
    clickCopyRun(5)
    expect(field().value).toBe('')
  })

  it('clicking slowly just copies', () => {
    vi.useFakeTimers()
    render(<PatchCode />)
    clickCopyRun(5, 2000)
    expect(field().value).toBe('')
  })

  it('hides Generate, since the long code needs no service', () => {
    render(<PatchCode />)
    clickCopyRun(5)
    expect(screen.queryByText(/GENERATE/)).toBeNull()
  })

  it('says so, so the mode is never a mystery', () => {
    render(<PatchCode />)
    expect(screen.getByText('CODE')).toBeDefined()
    clickCopyRun(5)
    expect(screen.getByText('PATCH CODE · DEV')).toBeDefined()
  })

  it('survives a reload, since it is for working not for showing off', () => {
    const first = render(<PatchCode />)
    clickCopyRun(5)
    first.unmount()

    render(<PatchCode />)
    expect(field().value).toBe(encodePatch(toPatch()))
  })
})

describe('pasting', () => {
  it('still takes a long code, which is how a patch travels without a service', () => {
    render(<PatchCode />)
    const other = { ...toPatch(), bpm: 77 }
    fireEvent.change(field(), { target: { value: encodePatch(other) } })
    expect(usePatchStore.getState().bpm).toBe(77)
  })

  it('looks up a short code, and then shows it as ready', async () => {
    const target = encodePatch({ ...toPatch(), bpm: 99 })
    resolveShortCode.mockResolvedValueOnce(target)

    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'K7M2QX' } })
    await vi.waitFor(() => expect(usePatchStore.getState().bpm).toBe(99))
    // It resolved, so it is on the service; asking to generate it again would be pointless.
    await vi.waitFor(() => expect(screen.getByText('GENERATED')).toBeDefined())
  })

  it('says when there is nothing under a code', async () => {
    resolveShortCode.mockResolvedValueOnce(null)
    render(<PatchCode />)
    fireEvent.change(field(), { target: { value: 'K7M2QX' } })
    await vi.waitFor(() => expect(screen.getByText('no such code')).toBeDefined())
  })
})
