import { useState, useCallback } from 'react';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save,
  Play,
  Upload,
  ArrowLeft,
  Webhook,
  GitBranch,
  MessageSquare,
  Database,
} from 'lucide-react';
import TriggerNode from '../nodes/TriggerNode';
import LogicNode from '../nodes/LogicNode';
import ActionNode from '../nodes/ActionNode';

const nodeTypes = {
  trigger: TriggerNode,
  logic: LogicNode,
  action: ActionNode,
};

let id = 0;
const getId = () => `node_${id++}`;

interface WorkflowEditorProps {
  onBack: () => void;
}

const nodeBlocks = [
  {
    category: 'Wyzwalacze',
    items: [{ type: 'trigger', label: 'Odbierz Webhook', icon: Webhook, description: 'HTTP endpoint' }],
  },
  {
    category: 'Bramki logiczne',
    items: [{ type: 'logic', label: 'Jesli / To (Warunek)', icon: GitBranch, description: 'Rozgalezienie' }],
  },
  {
    category: 'Akcje',
    items: [
      { type: 'action', label: 'Wyslij na Slack', icon: MessageSquare, description: 'Powiadomienie' },
      { type: 'action', label: 'Zapisz do Bazy', icon: Database, description: 'INSERT/UPDATE' },
    ],
  },
];

export default function WorkflowEditor({ onBack }: WorkflowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow/type');
      const label = event.dataTransfer.getData('application/reactflow/label');
      const description = event.dataTransfer.getData('application/reactflow/description');

      if (typeof type === 'undefined' || !type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getId(),
        type,
        position,
        data: { label, description: description || 'Przeciagniety klocek' },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string, description: string) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.setData('application/reactflow/description', description);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex-1 flex flex-col bg-muted/30">
      <header className="bg-white border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót
          </button>
          <div className="h-6 w-px bg-border" />
          <h2 className="text-lg font-medium text-foreground">Nowy Workflow</h2>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors">
            <Save className="w-4 h-4" />
            Zapisz
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors">
            <Play className="w-4 h-4" />
            Testuj
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            <Upload className="w-4 h-4" />
            Publikuj
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        <aside className="w-72 bg-white border-r border-border overflow-y-auto">
          <div className="p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Przeciągnij na płótno
            </p>
            {nodeBlocks.map((block) => (
              <div key={block.category} className="mb-6">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {block.category}
                </h3>
                <div className="space-y-2">
                  {block.items.map((item) => {
                    const Icon = item.icon;
                    const bgColors = {
                      trigger: 'bg-trigger-light border-trigger/30 hover:border-trigger/50',
                      logic: 'bg-logic-light border-logic/30 hover:border-logic/50',
                      action: 'bg-action-light border-action/30 hover:border-action/50',
                    };
                    const iconColors = {
                      trigger: 'text-trigger',
                      logic: 'text-logic',
                      action: 'text-action',
                    };
                    return (
                      <div
                        key={item.label}
                        className={`p-3 border rounded-lg cursor-grab transition-colors ${bgColors[item.type as keyof typeof bgColors]}`}
                        onDragStart={(e) => onDragStart(e, item.type, item.label, item.description)}
                        draggable
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${iconColors[item.type as keyof typeof iconColors]}`} />
                          <span className="text-sm font-medium text-foreground">{item.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 ml-6">{item.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex-1">
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
            defaultEdgeOptions={{
              style: { strokeWidth: 2, stroke: '#94a3b8' },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
