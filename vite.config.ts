import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

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

/**
 * How the output is split, and why it is split at all.
 *
 * Not to reduce the total — the same bytes are shipped either way — but to decide **which of them a
 * browser has to fetch again after a change.** Three quarters of this build is other people's code:
 * react-dom is 38 % of it and React Flow with its d3 dependencies another 27 %. In one file, editing a
 * sentence in the manual invalidates all of it. Split, a release of app code leaves those two chunks in
 * cache untouched, which is the difference between a 190 kB download and a 30 kB one on every visit
 * after the first.
 *
 * Two vendor chunks rather than one, because they change at different rates and for different reasons:
 * React moves on its own schedule and the canvas library on another, and a chunk is only worth having
 * if it can go stale independently.
 *
 * Everything else is left to Rollup. Hand-naming chunks for our own modules would be guessing at an
 * import graph the bundler already knows, and a wrong guess here does not fail — it silently duplicates
 * a module into two chunks.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return
  if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)) return 'react'
  if (/node_modules\/(@xyflow|d3-|dagre)/.test(id)) return 'canvas'
}

// https://vite.dev/config/
/**
 * Which build this is, so a bug report can name one.
 *
 * The commit's own sha and date rather than the time it was compiled. A timestamp would change the
 * bundle on every build even with nothing edited, which is the opposite of what the chunk splitting is
 * for — two vendor chunks exist so a release of app code leaves them in cache, and a define that moved
 * every time would invalidate the app chunk for no reason at all.
 *
 * `GITHUB_SHA` first because CI has it without asking git, then git, then `dev` — a checkout with no
 * history is a legitimate way to run this and not a reason to fail a build.
 */
function buildId(): string {
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7) || run('git rev-parse --short=7 HEAD')
  const date = run('git show -s --format=%cs HEAD')
  if (!sha) return 'dev'
  return date ? `${sha} · ${date}` : sha
}

function run(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export default defineConfig({
  plugins: [react(), worklets()],
  // A string, so it is inlined wherever it is read and costs nothing at runtime.
  define: { __BUILD__: JSON.stringify(buildId()) },
  // Relative paths: it serves the same from the root of its own domain as from a GitHub Pages
  // subpath (user.github.io/castillon/).
  base: './',
  build: {
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
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
