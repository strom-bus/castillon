import {
  ConnectionMode,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type IsValidConnection,
} from '@xyflow/react'
import { useCallback, useMemo, useRef } from 'react'
import { NODE_DEFINITIONS } from '../nodes/registry'
import { canConnect } from '../state/connections'
import { usePatchStore, type FlowEdge } from '../state/patchStore'
import { computeDepths, DepthContext, EMPTY_DEPTHS, sameDepths } from '../viz/depth'
import { edgeTypes, nodeTypes } from './flowTypes'
import { LoadMeter } from './LoadMeter'
import { RandomButton } from './RandomButton'
import { useCopyPaste } from './useCopyPaste'
import { useUndoRedo } from './useUndoRedo'

function CanvasInner() {
  useCopyPaste()
  useUndoRedo()

  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)
  const onNodesChange = usePatchStore((s) => s.onNodesChange)
  const spliceIntoCable = usePatchStore((s) => s.spliceIntoCable)
  const onEdgesChange = usePatchStore((s) => s.onEdgesChange)
  const onConnect = usePatchStore((s) => s.onConnect)
  const addNode = usePatchStore((s) => s.addNode)
  const select = usePatchStore((s) => s.select)
  const removeEdge = usePatchStore((s) => s.removeEdge)

  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  // Dragging a node yields a fresh `nodes` array every frame without changing the graph's
  // structure. Keeping the previous reference when the result matches means a drag does not
  // repaint every node over a colour that did not change.
  //
  // The ref is read and written during render, which the linter rightly flags in general and which
  // is safe here: it only ever holds a result of `computeDepths`, and it is only ever returned when
  // `sameDepths` says it carries the same value as the fresh one. A render that gets discarded can
  // therefore leave behind nothing but a value-equal object, which is exactly what the consumers
  // treat as interchangeable. This is the caching case React's own docs allow.
  const previousDepths = useRef(EMPTY_DEPTHS)
  const depths = useMemo(() => {
    const next = computeDepths(nodes, edges)
    // oxlint-disable-next-line react/refs
    if (sameDepths(next, previousDepths.current)) return previousDepths.current
    // oxlint-disable-next-line react/refs
    previousDepths.current = next
    return next
  }, [nodes, edges])

  /** Same rules the store commits with, so what the canvas allows and what it accepts agree. */
  const isValidConnection = useCallback<IsValidConnection<FlowEdge>>((connection) => {
    const { nodes: current, edges: wired } = usePatchStore.getState()
    return canConnect({ nodes: current, edges: wired }, connection)
  }, [])

  const addAtCenter = useCallback(
    (type: string) => {
      const rect = wrapper.current?.getBoundingClientRect()
      const position = screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
      })
      addNode(type, position)
    },
    [addNode, screenToFlowPosition],
  )

  return (
    <div className="canvas" ref={wrapper}>
      {/* Driven by the registry, so adding a node type really is one file plus one line. */}
      <div className="palette">
        {NODE_DEFINITIONS.map((definition) => (
          <button
            key={definition.type}
            type="button"
            className="btn"
            onClick={() => addAtCenter(definition.type)}
          >
            + {definition.label}
          </button>
        ))}
      </div>
      {/* Opposite the palette: on the left what a patch can gain, on the right what it costs. */}
      <div className="load-corner">
        <LoadMeter />
      </div>
      <DepthContext.Provider value={depths}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, node) => select(node.id)}
          // A node let go of on a cable goes into it. Only one with nothing wired to it, so dragging
          // a node that is already in the cascade never rearranges the patch under your hand — and a
          // node you have just added is the only kind that can land in a cable.
          onNodeDragStop={(_, node) => spliceIntoCable(node.id)}
          // Clicking a cable removes it. The wide transparent hit path in CascadeEdge is what
          // makes a 2 px bezier clickable at all.
          onEdgeClick={(_, edge) => removeEdge(edge.id)}
          onPaneClick={() => select(null)}
          defaultEdgeOptions={{ type: 'cascade' }}
          // A side port takes a cable either way, which React Flow only permits loosely. Everything
          // it stops checking as a result is checked by `connectionFor`, which decided the direction
          // anyway.
          connectionMode={ConnectionMode.Loose}
          proOptions={{ hideAttribution: true }}
          // Both keys: Supr and Backspace sit in different places on different keyboards, and
          // React Flow only listens for one of them by default. It ignores either while a text
          // field has focus, so typing in the patch code is unaffected.
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.2}
          maxZoom={2}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e1e1e" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </DepthContext.Provider>
      <div className="dice-corner">
        <RandomButton />
      </div>
      <span className="colophon">COLMENA / STROMBUS</span>
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
