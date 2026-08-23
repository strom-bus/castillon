import { installWorkletStub } from '../audio/fakeAudio'

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

/*
 * The two that reach into a prototype rather than adding a global, so they need one to reach into.
 *
 * Guarded because a test file may ask for the `node` environment instead — the worklet bundling test does,
 * since esbuild refuses to run where jsdom's `TextEncoder` is. Everything above is `??=` on a global and
 * harmless without a DOM; these two threw, and the setup file taking down a suite that never touches a
 * DOM is a poor reason not to write it.
 */
if (typeof HTMLElement !== 'undefined') {
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
}

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

/** jsdom has no clipboard, and a component that copies has to be testable. */
const clipboard = { writeText: async (_text: string) => {} }
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
}

/**
 * `AudioWorkletNode`, which jsdom has no notion of.
 *
 * The stub itself lives beside the fake audio context, so that a worklet's parameters land in the
 * same registry as every other parameter and a test can ask what is connected to one without knowing
 * which sort of node it belongs to.
 */
installWorkletStub()
