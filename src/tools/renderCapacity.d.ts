/**
 * `AudioContext.renderCapacity`, which TypeScript's DOM library does not know about yet.
 *
 * Chrome's own instrument for the question `MAX_LOAD` is an answer to: how close the audio thread is to
 * missing a deadline, and how often it already has. Everything else available — timing a render, timing
 * a callback — measures the wrong thread.
 *
 * Declared globally, which is the same compromise the worklet scope makes: the compiler will believe
 * this exists in browsers that do not have it. Every use of it is behind a runtime check.
 */

interface AudioRenderCapacityEvent extends Event {
  /** Seconds of audio the reading covers. */
  readonly timestamp: number
  /** Share of a render quantum used, averaged over the interval. 0 to 1. */
  readonly averageLoad: number
  /** The worst single quantum in the interval. Past 1 is a missed deadline. */
  readonly peakLoad: number
  /** Share of quanta that could not be produced in time. Anything above zero is an audible dropout. */
  readonly underrunRatio: number
}

interface AudioRenderCapacity extends EventTarget {
  start(options?: { updateInterval?: number }): void
  stop(): void
  onupdate: ((event: AudioRenderCapacityEvent) => void) | null
}

interface AudioContext {
  readonly renderCapacity?: AudioRenderCapacity
}
