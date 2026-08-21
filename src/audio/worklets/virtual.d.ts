/**
 * Processors bundled to a string by the `castillon-worklets` plugin in `vite.config.ts`.
 *
 * A virtual module rather than an import of the file itself, because the file has to arrive at
 * `AudioWorkletGlobalScope` as one self-contained script and Vite's own worker handling only does
 * that in a build. See the plugin for why that mattered.
 */
declare module 'virtual:worklet/*' {
  const source: string
  export default source
}
