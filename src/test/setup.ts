/**
 * jsdom implements none of this, and React Flow needs it to measure the canvas.
 * Without these stubs the app cannot be mounted in tests.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

class DOMMatrixReadOnlyStub {
  m22 = 1
  constructor(transform?: string) {
    const scale = transform?.match(/matrix\([^,]+,[^,]+,[^,]+,\s*([^,]+)/)
    if (scale) this.m22 = Number(scale[1])
  }
}

globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return Number(this.style.height?.replace('px', '')) || 400
  },
})

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return Number(this.style.width?.replace('px', '')) || 800
  },
})

globalThis.DOMRect ??= class {
  x = 0
  y = 0
  width = 800
  height = 600
  top = 0
  left = 0
  right = 800
  bottom = 600
  static fromRect() {
    return new (globalThis.DOMRect as unknown as new () => DOMRect)()
  }
  toJSON() {
    return this
  }
} as unknown as typeof DOMRect
