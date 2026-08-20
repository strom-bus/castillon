import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePatchStore } from '../state/patchStore'
import { ExportAudio } from './ExportAudio'

/**
 * The render itself needs an `OfflineAudioContext`, which jsdom has not got, so what is covered here
 * is the path that reaches a person: asking for a file from a patch that cannot make one has to say
 * so. Everything that decides the length of a real render is tested in `render.test.ts`, and the
 * bytes in `wav.test.ts`.
 */

describe('ExportAudio', () => {
  it('offers a count of repetitions rather than a number of seconds', () => {
    render(<ExportAudio />)
    expect(screen.getByLabelText('Repetitions to render')).toBeDefined()
    expect(screen.getByText('EXPORT')).toBeDefined()
  })

  it('says what is wrong instead of failing quietly on a patch with nothing to play', async () => {
    usePatchStore.setState({ nodes: [], edges: [] })
    render(<ExportAudio />)

    fireEvent.click(screen.getByText('EXPORT'))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Nothing to render')
    })
    // And it says what to do about it, not just that it failed.
    expect(screen.getByRole('status').textContent).toContain('Ignite')
  })

  it('comes back from a failure ready to try again', async () => {
    usePatchStore.setState({ nodes: [], edges: [] })
    render(<ExportAudio />)

    fireEvent.click(screen.getByText('EXPORT'))
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined())

    // Not stuck reading RENDERING: a render that fails has to leave the button usable.
    expect(screen.getByText('EXPORT')).toBeDefined()
  })
})
