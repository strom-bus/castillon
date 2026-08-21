import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const WORKLET_PREFIX = 'virtual:worklet/'

/**
 * Bundles an `AudioWorklet` processor to a string, the same way in dev as in a build.
 *
 * A processor runs in `AudioWorkletGlobalScope`, which cannot resolve imports — so it has to arrive
 * as one self-contained file. Vite's own `?worker&url` does that in a build and *not* in dev, where it
 * serves the module with its imports intact: the processor would fail to register, the engine would
 * fall back silently, and the feature would appear not to work in the one place it gets tried.
 *
 * So esbuild is asked directly, in both modes. The processor keeps importing `decimate` from
 * `audio/dsp.ts`, which is what keeps that arithmetic an ordinary tested function rather than a copy
 * living inside a string.
 *
 * The result is inlined as text and registered from a `Blob`, which costs a few hundred bytes in the
 * bundle and removes any question of what URL resolves to what.
 */
function worklets(): Plugin {
  return {
    name: 'castillon-worklets',
    resolveId(id) {
      if (id.startsWith(WORKLET_PREFIX)) return `\0${id}`
    },
    async load(id) {
      if (!id.startsWith(`\0${WORKLET_PREFIX}`)) return
      const name = id.slice(`\0${WORKLET_PREFIX}`.length)
      // Absolute: a relative path here is read as an import specifier and fails to resolve.
      const entry = resolve(`src/audio/worklets/${name}.ts`)

      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        // What every browser with `AudioWorklet` also has, so nothing needs transpiling down.
        target: 'es2022',
        minify: true,
      })

      // Watched, so editing the processor reloads in dev like editing anything else.
      this.addWatchFile(entry)
      return `export default ${JSON.stringify(result.outputFiles[0].text)}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), worklets()],
  // Relative paths: it serves the same from the root of its own domain as from a GitHub Pages
  // subpath (user.github.io/castillon/).
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest stubs CSS imports to an empty string by default, `?raw` included, which makes a
    // stylesheet unreadable from a test. `brand.test.ts` has to read the real thing to check that
    // the wordmark's keyframes still match the cascade ramp, so CSS gets processed.
    css: true,
  },
})
