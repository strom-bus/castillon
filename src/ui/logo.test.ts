import { describe, expect, it } from 'vitest'
import favicon from '../../public/favicon.svg?raw'
import tokens from '../index.css?raw'
import { CABLES, NODES, NODE_RADIUS } from './logoGeometry'

/**
 * The mark exists twice — as a component and as a static favicon — and it has to. A favicon is read
 * before any script runs, so it cannot be rendered by React. Two copies of one drawing drift apart
 * silently: the tab would keep an old shape for months while the titlebar showed a new one.
 *
 * So the favicon is parsed and compared against the numbers the component draws from. It accepts
 * either shape of node, since which one the mark uses is still being decided.
 */

interface Node {
  cx: number
  cy: number
  r: number
}

/** The favicon's nodes, whether drawn as circles or as squares. */
function faviconNodes(): Node[] {
  const circles = [
    ...favicon.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g),
  ].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }))
  const rects = [
    ...favicon.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"/g),
  ]
    .map((m) => {
      const half = Number(m[3]) / 2
      return { cx: Number(m[1]) + half, cy: Number(m[2]) + half, r: half }
    })
    // The background tile fills the viewBox: it is what makes a white mark visible on a light tab
    // strip, and it is not one of the nodes.
    .filter((node) => node.r * 2 < 100)
  return [...circles, ...rects]
}

const key = (node: Node) => `${node.cx},${node.cy},${node.r}`

/** HSL to a lowercase hex triple, since an SVG attribute cannot hold a custom property. */
function hexOf(h: number, s: number, l: number): string {
  const chroma = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l / 100 - chroma / 2
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const byte = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

describe('the isotype', () => {
  it('is a file a browser can actually parse', () => {
    // It was not, once: an XML comment cannot contain a double hyphen, and naming a CSS custom
    // property in one made the whole file invalid. A browser answers that by silently keeping the
    // icon it already had, so the mark looked merely stale rather than broken.
    const parsed = new DOMParser().parseFromString(favicon, 'image/svg+xml')
    const failure = parsed.querySelector('parsererror')
    expect(failure?.textContent ?? null).toBeNull()
    expect(parsed.documentElement.tagName).toBe('svg')
  })

  it('is three nodes in both copies', () => {
    expect(faviconNodes()).toHaveLength(NODES.length)
    expect(NODES).toHaveLength(3)
  })

  it('places and sizes them identically', () => {
    const expected = NODES.map((node) => key({ ...node, r: NODE_RADIUS })).sort()
    expect(faviconNodes().map(key).sort()).toEqual(expected)
  })

  it('draws the same two cables', () => {
    // Anchored to `<path`, or `id="r"` on the gradient matches a bare `d="` and adds a third cable.
    const drawn = [...favicon.matchAll(/<path[^>]*\sd="([^"]+)"/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim())
      .sort()
    expect(drawn).toEqual([...CABLES].sort())
  })

  it('is painted in the same orange as the wordmark', () => {
    // A third copy of one value: the token in `index.css`, the ramp in `depth.ts`, and this file,
    // which can hold neither because a favicon is read before any stylesheet or script.
    const declared = tokens.match(/--brand-lit:\s*hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/)
    expect(declared).not.toBeNull()
    const expected = hexOf(Number(declared![1]), Number(declared![2]), Number(declared![3]))

    const painted = new Set(
      [...favicon.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()),
    )
    expect([...painted]).toEqual([expected])
  })

  it('stands on its own, with no tile behind it', () => {
    // The tile was there to keep a white mark off a white tab strip. The orange does not need one,
    // and a mark that carries its own contrast is the better mark.
    expect(favicon).not.toContain('width="100"')
  })

  it('keeps the nodes inside the viewBox at whatever radius they are given', () => {
    // A radius grown past the edge clips, and only at small sizes where nobody is looking.
    for (const node of NODES) {
      expect(Math.min(node.cx, node.cy) - NODE_RADIUS).toBeGreaterThanOrEqual(0)
      expect(Math.max(node.cx, node.cy) + NODE_RADIUS).toBeLessThanOrEqual(100)
    }
  })
})
