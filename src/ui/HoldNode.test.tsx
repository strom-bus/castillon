/**
 * What a HOLD shows about itself.
 *
 * It can be doing three things and it says all of them at once, each only when it is doing it. That is
 * the whole reason a merged node is readable at all: "0 ms · 1:1 · 100%" would be three ways of writing
 * *nothing*, and a node that said it would be worse than the two nodes this replaced.
 */

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from '../state/patchStore'
import type { HoldParams } from '../types/patch'
import { HoldNode } from './nodes'

const store = () => usePatchStore.getState()

/** A HOLD on the canvas with these settings over its defaults, and its rendered element. */
function showHold(over: Partial<HoldParams> = {}): HTMLElement {
  store().addNode('hold', { x: 0, y: 0 })
  const hold = store().nodes.at(-1)!
  if (Object.keys(over).length > 0) store().updateParams(hold.id, over)

  const { container } = render(
    <ReactFlowProvider>
      <HoldNode
        id={hold.id}
        data={{ params: usePatchStore.getState().nodes.find((n) => n.id === hold.id)!.data.params }}
        selected={false}
        type="hold"
        dragging={false}
        zIndex={0}
        isConnectable
        draggable
        selectable
        deletable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </ReactFlowProvider>,
  )
  return container.querySelector('.node-hold') as HTMLElement
}

beforeEach(() => {
  store().resetPatch()
})

describe('a HOLD on the canvas', () => {
  it('says it is a wire when it is set to nothing', () => {
    // Which is how it arrives. The old DELAY could not say this, because it could not be set to it.
    const node = showHold()
    expect(node.querySelector('.hold-thru')?.textContent).toBe('thru')
    expect(node.querySelector('.delay-value')).toBeNull()
    expect(node.querySelector('.hold-count')).toBeNull()
  })

  it('shows the wait, and only the wait, when that is all it does', () => {
    const node = showHold({ waitMs: 320 })
    expect(node.querySelector('.delay-value')?.textContent).toContain('320')
    expect(node.querySelector('.hold-count')).toBeNull()
    expect(node.querySelector('.hold-thru')).toBeNull()
  })

  it('shows the condition as a musician writes it', () => {
    // The first of every two is 1:2, and it is on the node rather than only in the panel because which
    // passes are this node's is the whole of what it does.
    const node = showHold({ every: 2, offset: 1 })
    expect(node.querySelector('.hold-count')?.textContent).toBe('1:2')
    expect(node.querySelector('.delay-value')).toBeNull()
  })

  it('shows both where it is doing both, which is the whole point of one node', () => {
    const node = showHold({ waitMs: 500, every: 3, offset: 2 })
    expect(node.querySelector('.delay-value')?.textContent).toContain('500')
    expect(node.querySelector('.hold-count')?.textContent).toBe('2:3')
    expect(node.querySelector('.hold-thru')).toBeNull()
  })

  it('says the odds only where they are not certain', () => {
    // "· 100%" beside a condition that already says everything about itself is noise.
    expect(showHold({ every: 2, offset: 1 }).querySelector('.node-meta')).toBeNull()
    expect(
      showHold({ every: 2, offset: 1, chance: 0.6 }).querySelector('.node-meta')?.textContent,
    ).toBe('60%')
  })

  it('carries a progress track only where there is a wait to fill it', () => {
    // The bar is the wait running down. With no wait there is nothing for it to show, and an empty
    // track under a node that never fills it reads as a node that is broken.
    expect(showHold({ waitMs: 200 }).querySelector('.delay-track')).not.toBeNull()
    expect(showHold({ every: 2, offset: 1 }).querySelector('.delay-track')).toBeNull()
  })
})
