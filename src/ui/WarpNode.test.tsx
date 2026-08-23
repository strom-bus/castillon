/**
 * What a warp shows about itself.
 *
 * It is never triggered, so it has no activity of its own — all it can say is what it is doing to
 * somewhere else: whether it is attached to anything, and whether the thing it is moving is playing.
 * Without that it looked the same whether it was doing everything or nothing at all, which for a node
 * whose only real failure is being attached to nothing is the one thing it ought to be able to say.
 */

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SIGNAL_LEFT, SIGNAL_RIGHT } from '../state/connections'
import { usePatchStore } from '../state/patchStore'
import { WarpNode } from './nodes'

const store = () => usePatchStore.getState()

function showWarp(attachTo?: string): HTMLElement {
  store().addNode('warp', { x: 0, y: 0 })
  const warp = store().nodes.at(-1)!
  if (attachTo) {
    store().onConnect({
      source: warp.id,
      target: attachTo,
      sourceHandle: SIGNAL_RIGHT,
      targetHandle: SIGNAL_LEFT,
    })
  }

  const { container } = render(
    <ReactFlowProvider>
      <WarpNode
        id={warp.id}
        data={{ params: warp.data.params }}
        selected={false}
        type="warp"
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
  return container.querySelector('.node-warp') as HTMLElement
}

beforeEach(() => {
  store().resetPatch()
})

describe('a warp on the canvas', () => {
  it('is idle while it is attached to nothing', () => {
    // Its only real failure, so it is the state worth being able to read across a canvas.
    expect(showWarp().className).toContain('idle')
  })

  it('is wired once it is attached to something', () => {
    const osc = store().nodes.find((n) => n.type === 'osc')!.id
    const node = showWarp(osc)
    expect(node.className).toContain('wired')
    expect(node.className).not.toContain('idle')
  })

  it('says which way it moves things, sign and all', () => {
    // +2 and 2 look alike at a glance and only one of them says which way.
    const osc = store().nodes.find((n) => n.type === 'osc')!.id
    store().addNode('warp', { x: 0, y: 0 })
    const warp = store().nodes.at(-1)!
    store().updateParams(warp.id, { transpose: 2 })
    store().onConnect({
      source: warp.id,
      target: osc,
      sourceHandle: SIGNAL_RIGHT,
      targetHandle: SIGNAL_LEFT,
    })

    const { container } = render(
      <ReactFlowProvider>
        <WarpNode
          id={warp.id}
          data={{
            params: usePatchStore.getState().nodes.find((n) => n.id === warp.id)!.data.params,
          }}
          selected={false}
          type="warp"
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
    expect(container.querySelector('.delay-value')?.textContent).toBe('+2')
  })
})
