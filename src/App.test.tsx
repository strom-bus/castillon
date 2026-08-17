import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('se puede importar y es un componente', () => {
    expect(typeof App).toBe('function')
  })
})
