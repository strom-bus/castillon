/**
 * What a follower shows about itself.
 *
 * It has no pulse of its own — nothing triggers it — so what it can report is whether it is wired at
 * *both* ends and whether the thing it is moving is sounding. Both ends matters here in a way it does not
 * for a WARP: a follower with nothing feeding it is silent however it is set, and that is the one failure
 * a person cannot see any other way.
 */

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SIGNAL_LEFT, SIGNAL_RIGHT } from '../state/connections'
import { usePatchStore } from '../state/patchStore'
import { FollowNode } from './nodes'

const store = () => usePatchStore.getState()

interface Wiring {
  /** An oscillator feeding its left port. */
  hearing?: boolean
  /** Its right port pointed at an oscillator. */
  pointing?: boolean
}

function showFollow({ hearing, pointing }: Wiring = {}): HTMLElement {
  store().addNode('follow', { x: 0, y: 0 })
  const node = store().nodes.at(-1)!
  const osc = store().nodes.find((n) => n.type === 'osc')!.id

  if (hearing) {
    store().onConnect({
      source: osc,
      target: node.id,
      sourceHandle: SIGNAL_RIGHT,
      targetHandle: SIGNAL_LEFT,
    })
  }
  if (pointing) {
    store().onConnect({
      source: node.id,
      target: osc,
      sourceHandle: SIGNAL_RIGHT,
      targetHandle: SIGNAL_LEFT,
    })
  }

  const { container } = render(
    <ReactFlowProvider>
      <FollowNode
        id={node.id}
        data={{
          params: usePatchStore.getState().nodes.find((n) => n.id === node.id)!.data.params,
        }}
        selected={false}
        type="follow"
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
  return container.querySelector('.node-follow') as HTMLElement
}

beforeEach(() => {
  store().resetPatch()
})

describe('a follower on the canvas', () => {
  it('is idle while it is wired at neither end', () => {
    expect(showFollow().className).toContain('idle')
  })

  it('is still idle while it is only pointed at something', () => {
    // The failure worth being able to read across a canvas: it is set up, it is connected, and it is
    // hearing nothing, so it does nothing.
    expect(showFollow({ pointing: true }).className).toContain('idle')
  })

  it('is still idle while it is only listening', () => {
    expect(showFollow({ hearing: true }).className).toContain('idle')
  })

  it('is wired once it has both ends', () => {
    const node = showFollow({ hearing: true, pointing: true })
    expect(node.className).toContain('wired')
    expect(node.className).not.toContain('idle')
  })

  it('says how far it moves what it is pointed at, sign and all', () => {
    // Signed like a WARP's transpose, because a follower is most often pulling *down* and the sign is
    // the whole reading: ducking and swelling are one control.
    store().addNode('follow', { x: 0, y: 0 })
    const node = store().nodes.at(-1)!
    store().updateParams(node.id, { depth: -0.45 })

    const { container } = render(
      <ReactFlowProvider>
        <FollowNode
          id={node.id}
          data={{
            params: usePatchStore.getState().nodes.find((n) => n.id === node.id)!.data.params,
          }}
          selected={false}
          type="follow"
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
    expect(container.querySelector('.delay-value')?.textContent).toBe('-45%')
  })
})
