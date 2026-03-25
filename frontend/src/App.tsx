import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  type Connection,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TriggerNode from './nodes/TriggerNode';
import LogicNode from './nodes/LogicNode';
import ActionNode from './nodes/ActionNode';

const nodeTypes = {
  trigger: TriggerNode,
  logic: LogicNode,
  action: ActionNode,
};

let id = 0;
const getId = () => `node_${id++}`;

function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Funkcja łącząca nody
  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Obsługa momentu przeciągania elementu z menu na canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const label = event.dataTransfer.getData('application/reactflow/label');

      if (typeof type === 'undefined' || !type) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: getId(),
        type,
        position,
        data: { label: label, description: 'Przeciągnięty klocek' },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900 w-full">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col z-10 shadow-sm">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-blue-600">Workflow Engine</h1>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Wyzwalacze (Triggers)</h2>
          <div className="space-y-3 mb-6">
            <div
              className="p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-grab hover:bg-blue-100 transition-colors shadow-sm"
              onDragStart={(e) => onDragStart(e, 'trigger', 'Odbierz Webhook')}
              draggable
            >
              Odbierz Webhook
            </div>
          </div>

          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Bramki Logiczne</h2>
          <div className="space-y-3 mb-6">
            <div
              className="p-3 bg-purple-50 border border-purple-200 rounded-lg cursor-grab hover:bg-purple-100 transition-colors shadow-sm"
              onDragStart={(e) => onDragStart(e, 'logic', 'Jeśli/To (Warunek)')}
              draggable
            >
              Jeśli / To (Warunek)
            </div>
          </div>

          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Akcje (Actions)</h2>
          <div className="space-y-3">
            <div
              className="p-3 bg-green-50 border border-green-200 rounded-lg cursor-grab hover:bg-green-100 transition-colors shadow-sm"
              onDragStart={(e) => onDragStart(e, 'action', '💬 Wyślij na Slack')}
              draggable
            >
              Wyślij na Slack
            </div>
            <div
              className="p-3 bg-green-50 border border-green-200 rounded-lg cursor-grab hover:bg-green-100 transition-colors shadow-sm"
              onDragStart={(e) => onDragStart(e, 'action', '💾 Zapisz do Bazy')}
              draggable
            >
              Zapisz do Bazy
            </div>
          </div>

        </div>
      </aside>

      {/* Główny obszar roboczy (Canvas) */}
      <main className="flex-1 flex flex-col relative" ref={reactFlowWrapper}>
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-10 absolute top-0 w-full">
          <h2 className="text-lg font-medium">Nowy Proces Automatyzacji</h2>
          <div className="flex space-x-3">
            <button
              onClick={() => { setNodes([]); setEdges([]); }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Wyczyść
            </button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium">
              Zapisz i Uruchom
            </button>
          </div>
        </header>
        <div className="flex-1 w-full h-full relative pt-16">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background color="#ccc" gap={16} />
            <Controls />
          </ReactFlow>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}