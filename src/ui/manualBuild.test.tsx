import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Manual } from './Manual'
import { useLanguage } from '../help/language'

/**
 * The build's name in the manual's header.
 *
 * It exists to be read out to somebody else, which is what decides everything about it: it is labelled,
 * so a bare seven-character string is not something a reader has to guess the purpose of; it is beside
 * the language toggle, where the header does not scroll; and it is substituted at compile time, so the
 * failure worth catching is a placeholder rather than a wrong answer.
 */

describe('the build shown in the manual', () => {
  beforeEach(() => {
    useLanguage.setState({ language: 'en' })
  })

  it('is labelled, and says the build', () => {
    render(<Manual onClose={() => {}} />)
    const shown = screen.getByText(/version:/i).textContent ?? ''
    expect(shown).toContain(__BUILD__)
    expect(shown).not.toContain('__BUILD__')
  })

  it('says it in the language the manual is being read in', () => {
    useLanguage.setState({ language: 'es' })
    render(<Manual onClose={() => {}} />)
    expect(screen.getByText(/versión:/i)).toBeDefined()
  })

  it('sits before the language toggle, which is where it was asked for', () => {
    /*
     * Order in the markup rather than a measured position: the header is one flex row in source order,
     * so "to the left of the toggle" is "earlier in the header" — and that is a fact a test can hold
     * without pretending to know how wide anything rendered.
     */
    const { container } = render(<Manual onClose={() => {}} />)
    const header = container.querySelector('.gallery-head')!
    const children = [...header.children]
    const build = children.findIndex((one) => one.classList.contains('manual-build'))
    const toggle = children.findIndex((one) => one.classList.contains('language-toggle'))
    expect(build).toBeGreaterThan(-1)
    expect(toggle).toBeGreaterThan(build)
  })
})
