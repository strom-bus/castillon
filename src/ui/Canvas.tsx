import {
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

function CanvasInner() {
  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)
  const onNodesChange = usePatchStore((s) => s.onNodesChange)
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
  const previousDepths = useRef(EMPTY_DEPTHS)
  const depths = useMemo(() => {
    const next = computeDepths(nodes, edges)
    if (sameDepths(next, previousDepths.current)) return previousDepths.current
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
          // Clicking a cable removes it. The wide transparent hit path in CascadeEdge is what
          // makes a 2 px bezier clickable at all.
          onEdgeClick={(_, edge) => removeEdge(edge.id)}
          onPaneClick={() => select(null)}
          defaultEdgeOptions={{ type: 'cascade' }}
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
      {/* Not decoration: the AGPL requires that anyone using the hosted app can reach its source. */}
      <span className="colophon">
        COLMENA
        <a href="https://github.com/strom-bus/castillon" target="_blank" rel="noreferrer">
          source
        </a>
      </span>
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
