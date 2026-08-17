import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type IsValidConnection,
} from '@xyflow/react'
import { useCallback, useRef } from 'react'
import { usePatchStore, type FlowEdge } from '../state/patchStore'
import { edgeTypes, nodeTypes } from './flowTypes'

function CanvasInner() {
  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)
  const onNodesChange = usePatchStore((s) => s.onNodesChange)
  const onEdgesChange = usePatchStore((s) => s.onEdgesChange)
  const onConnect = usePatchStore((s) => s.onConnect)
  const addNode = usePatchStore((s) => s.addNode)
  const select = usePatchStore((s) => s.select)

  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  /** Sin auto-conexiones ni cables duplicados. */
  const isValidConnection = useCallback<IsValidConnection<FlowEdge>>((connection) => {
    if (connection.source === connection.target) return false
    return !usePatchStore
      .getState()
      .edges.some((e) => e.source === connection.source && e.target === connection.target)
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
      <div className="palette">
        <button type="button" className="btn" onClick={() => addAtCenter('osc4')}>
          + OSC 4
        </button>
        <button type="button" className="btn" onClick={() => addAtCenter('start')}>
          + START
        </button>
      </div>
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
        onPaneClick={() => select(null)}
        defaultEdgeOptions={{ type: 'cascade' }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e1e1e" />
        <Controls showInteractive={false} />
      </ReactFlow>
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
