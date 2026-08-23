/**
 * What exists inside `AudioWorkletGlobalScope` and nowhere else.
 *
 * TypeScript ships no lib for it, so these two are declared here. They are declared **globally**,
 * which is the compromise: the compiler will now believe they exist in app code too, where they do
 * not. The alternative is a second `tsconfig` covering only this directory, which is a lot of
 * machinery to protect against calling `registerProcessor` inside a React component.
 *
 * Only files in this directory may use them, and those files are the ones built as worklet entries.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}

/**
 * The rate the context runs at, which a processor is told and cannot ask for.
 *
 * There is no `AudioContext` in here to read it off, and it matters: everything the comb resonator does
 * is a length in samples, so the same note is a different number of them at 44.1 kHz and at 48.
 */
declare const sampleRate: number

declare function registerProcessor(
  name: string,
  processor: new (options?: unknown) => AudioWorkletProcessor,
): void
