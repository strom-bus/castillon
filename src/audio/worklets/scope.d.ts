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

declare function registerProcessor(
  name: string,
  processor: new (options?: unknown) => AudioWorkletProcessor,
): void
