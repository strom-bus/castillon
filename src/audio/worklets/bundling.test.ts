// @vitest-environment node
//
// Node and not jsdom, which is not a preference: esbuild refuses to run where `TextEncoder` produces
// something other than a real `Uint8Array`, and jsdom's does. Nothing here touches a DOM anyway.

import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { WORKLET_PARAMS } from './names'

/**
 * That every processor in this directory still bundles to one self-contained script.
 *
 * The failure this guards is silent in the worst possible way. A processor runs in
 * `AudioWorkletGlobalScope`, which cannot resolve imports — so a bundle that keeps one throws on
 * `addModule`, `registerWorklets` catches it and answers false, and every effect that needs a worklet
 * quietly takes its fallback path. Nothing logs, nothing breaks, and the feature simply appears not to
 * work. That is the exact bug the plugin in `vite.config.ts` was written to prevent, and until now
 * nothing checked that it kept preventing it.
 *
 * Bundled the same way the plugin bundles, because a test that used different settings would be
 * checking a different thing.
 */

const DIRECTORY = 'src/audio/worklets'

/**
 * Which files are processors, asked of the files.
 *
 * A processor is a file that registers one — that is the definition, not a property of its name — so
 * this reads for the call rather than keeping a list beside the directory. A list would have to be
 * extended by whoever adds the fourth worklet, which is precisely the person who has just learnt that
 * this file exists.
 */
function entries(): string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.includes('.test.'))
    .filter((name) => readFileSync(`${DIRECTORY}/${name}`, 'utf8').includes('registerProcessor('))
    .map((name) => name.replace(/\.ts$/, ''))
}

/** Exactly what `vite.config.ts` asks esbuild for. Kept identical on purpose. */
async function bundled(name: string): Promise<string> {
  const result = await build({
    entryPoints: [`${DIRECTORY}/${name}.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
  })
  return result.outputFiles[0].text
}

describe('the worklet processors', () => {
  it('are found by what they do rather than by a list', () => {
    // The guard against this whole file passing by finding nothing to check.
    expect(entries().length).toBeGreaterThan(2)
  })

  it.each(entries())('%s bundles to a script with nothing left to import', async (name) => {
    const source = await bundled(name)
    expect(source).toContain('registerProcessor')
    // Any surviving import is the failure: `AudioWorkletGlobalScope` has no resolver, so the module
    // throws on registration and the app falls back without saying so.
    expect(source, `${name} keeps an import`).not.toMatch(/(^|[;{}\s])import[ ("']/)
    expect(source, `${name} keeps a require`).not.toMatch(/\brequire\(/)
  })

  it('register the names and the parameters the shared table declares, exactly', async () => {
    /*
     * The other half of `WORKLET_PARAMS` being the one declaration. It is read by the processors, which
     * makes it right by construction, and by the `AudioWorkletNode` stub in `fakeAudio.ts` — where being
     * right by construction is the whole point, since a stub that knows a different set of parameters
     * from the real processor makes every test around it answer a question about the stub.
     *
     * The bundle is **run**, not read. Two earlier attempts read it instead and both were worthless: a
     * substring search could not notice an *extra* processor, and a regex for a string literal found
     * nothing at all, because minification turns `registerProcessor(COMB, Comb)` into
     * `registerProcessor(p, x)`. Running it is also strictly stronger — a processor that throws while
     * registering fails here rather than falling back silently in a browser.
     */
    const registered = new Map<string, unknown>()

    for (const name of entries()) {
      const source = await bundled(name)
      runInNewContext(source, {
        // What `AudioWorkletGlobalScope` provides and nothing else does. If a processor comes to need
        // more of it, this is where that shows up — as a failure rather than as a silent fallback.
        registerProcessor: (as: string, processor: unknown) => registered.set(as, processor),
        AudioWorkletProcessor: class {},
        sampleRate: 48000,
      })
    }

    expect([...registered.keys()].sort()).toEqual(Object.keys(WORKLET_PARAMS).sort())

    for (const [as, processor] of registered) {
      const declared = (processor as { parameterDescriptors?: unknown }).parameterDescriptors
      expect(declared, `${as} declares its own parameters instead of the shared ones`).toEqual(
        WORKLET_PARAMS[as],
      )
    }
  })
})
