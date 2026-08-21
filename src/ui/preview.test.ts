import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { HEIGHT, WIDTH } from '../tools/ogImage'

/**
 * The link preview, which nothing else would notice going missing.
 *
 * It is a committed file referenced from `index.html` by an absolute URL, so every way it can break is
 * silent: the file deleted, the tag pointing somewhere else, the image the wrong shape. What a crawler
 * does when it cannot fetch the image is show no card at all — the same as having no tags.
 */

const html = readFileSync('index.html', 'utf8')

describe('the preview tags', () => {
  it('names an absolute image URL, since a relative one is not resolved', () => {
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1]
    expect(image).toBeDefined()
    expect(image!.startsWith('https://')).toBe(true)
  })

  it('asks for the large card, not the thumbnail', () => {
    expect(html).toContain('content="summary_large_image"')
  })

  it('carries a title and a description, which are the card either side of the image', () => {
    expect(html).toMatch(/og:title/)
    expect(html).toMatch(/og:description/)
  })

  it('declares the size it actually is', () => {
    expect(html).toContain(`content="${WIDTH}"`)
    expect(html).toContain(`content="${HEIGHT}"`)
  })
})

describe('the image itself', () => {
  const png = readFileSync('public/og.png')

  it('is there, and is a PNG — no crawler takes an SVG', () => {
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })

  it('is the size the tags promise', () => {
    // The IHDR chunk carries the dimensions, which saves decoding the whole thing to check them.
    expect(png.readUInt32BE(16)).toBe(WIDTH)
    expect(png.readUInt32BE(20)).toBe(HEIGHT)
  })

  it('is the file the tags point at', () => {
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(image).toContain('/og.png')
  })
})
