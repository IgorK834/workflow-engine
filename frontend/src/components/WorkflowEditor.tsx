import { useState, useCallback, useMemo } from 'react';
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
  Settings2,
  X,
  Globe,
  Mail,
  Clock,
  FileJson
} from 'lucide-react';
import TriggerNode from '../nodes/TriggerNode';
import LogicNode from '../nodes/LogicNode';
import ActionNode from '../nodes/ActionNode';
import { createWorkflow } from '../api/workflows';

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
    items: [{ type: 'trigger', subtype: 'webhook', label: 'Odbierz Webhook', icon: Webhook, description: 'HTTP endpoint' }],
  },
  {
    category: 'Bramki logiczne i Narzędzia',
    items: [
      { type: 'logic', subtype: 'if_else', label: 'Jeśli / To (Warunek)', icon: GitBranch, description: 'Rozgałęzienie' },
      { type: 'logic', subtype: 'delay', label: 'Opóźnienie czasowe', icon: Clock, description: 'Pause & Resume (Baza)' },
      { type: 'logic', subtype: 'json_transform', label: 'Filtruj Dane', icon: FileJson, description: 'Wybiera tylko wybrane pola' },
    ],
  },
  {
    category: 'Akcje',
    items: [
      { type: 'action', subtype: 'slack_msg', label: 'Wyślij na Slack', icon: MessageSquare, description: 'Powiadomienie' },
      { type: 'action', subtype: 'send_email', label: 'Wyślij Email', icon: Mail, description: 'Wiadomość z systemu' },
      { type: 'action', subtype: 'http_request', label: 'Zewnętrzny Webhook API', icon: Globe, description: 'Request HTTP (GET/POST)' },
      { type: 'action', subtype: 'db_insert', label: 'Zapisz do Bazy', icon: Database, description: 'INSERT/UPDATE' },
    ],
  },
];

export default function WorkflowEditor({ onBack }: WorkflowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false;

      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.type === 'trigger') return false;

      return true;
    },
    [nodes]
  );

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    setSelectedNodeId(selectedNodes.length === 1 ? selectedNodes[0].id : null);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow/type');
      const subtype = event.dataTransfer.getData('application/reactflow/subtype');
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
        data: { label, subtype, config: {}, description: description || 'Przeciągnięty klocek' },
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(newNode.id);
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, subtype: string, label: string, description: string) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/subtype', subtype);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.setData('application/reactflow/description', description);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Funkcja aktualizująca config wybranego węzła
  const updateNodeConfig = (key: string, value: string) => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...(n.data.config as Record<string, any> || {}),
                [key]: value,
              },
            },
          };
        }
        return n;
      })
    );
  };

  const handleSave = async () => {
    // Walidacja główna
    const hasTrigger = nodes.some(n => n.type === 'trigger');
    if (!hasTrigger) {
      alert('Błąd: Twój proces musi zawierać co najmniej jeden wyzwalacz!');
      return;
    }

    // Serializacja danych do formatu zgodnego ze schematem
    const payload = {
      name: `Nowy Workflow - ${new Date().toLocaleTimeString()}`,
      description: "Wygenerowano z kreatora",
      graph_json: {
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: {
            subtype: n.data.subtype,
            label: n.data.label,
            config: n.data.config || {}
          }
        })),
        edges: edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null
        }))
      }
    };

    // Wysyłanie do API
    try {
      console.log("Wysyłam payload: ", payload);
      await createWorkflow(payload);
      alert('Proces pomyślnie zapisany!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas zapisu do bazy danych!');
    }
  };

  // Switch generujący formularz pod konkretny typ klocka
  const renderConfigForm = () => {
    if (!selectedNode) return null;
    const subtype = selectedNode.data.subtype as string;
    const config = (selectedNode.data.config as Record<string, any>) || {};

    switch (subtype) {
      case 'webhook':
        return (
          <div className="space-y-4">
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="text-sm font-semibold text-foreground mb-2">Twój adres Webhook</h4>
              <div className="bg-white p-3 border border-border rounded-md text-xs font-mono text-muted-foreground break-all mb-3 shadow-sm">
                [POST] /api/v1/workflows/<span className="text-primary font-bold">{"{ID_PROCESU}"}</span>/trigger
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                Zapisz swój proces, a następnie skopiuj jego ID z Dashboardu i wstaw w miejsce zaznaczone na niebiesko.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Aby uruchomić proces, system zewnętrzny musi wysłać żądanie HTTP na powyższy adres.
              </p>
            </div>
          </div>
        );

      case 'slack_msg':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Gdzie wysłać powiadomienie?</label>
              <input
                type="text"
                placeholder="np. #ogolny lub @janek"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.channel || ''}
                onChange={(e) => updateNodeConfig('channel', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Treść wiadomości</label>
              <textarea
                placeholder="Wpisz treść, np.: Mamy nowe zgłoszenie w systemie!"
                rows={4}
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.message || ''}
                onChange={(e) => updateNodeConfig('message', e.target.value)}
              />
            </div>
          </div>
        );

      case 'if_else':
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Pole do sprawdzenia</label>
              <input
                type="text"
                placeholder="np. kwota_zamowienia"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.variable || ''}
                onChange={(e) => updateNodeConfig('variable', e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Nazwa parametru, który przyszedł z wyzwalacza.</p>
            </div>            
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Warunek logiczny</label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.operator || 'equals'}
                onChange={(e) => updateNodeConfig('operator', e.target.value)}
              >
                <option value="equals">Jest równe dokładnie</option>
                <option value="greater">Jest większe niż</option>
                <option value="less">Jest mniejsze niż</option>
                <option value="contains">Zawiera tekst</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Wartość docelowa</label>
              <input
                type="text"
                placeholder="np. 100 lub 'Aktywny'"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.value || ''}
                onChange={(e) => updateNodeConfig('value', e.target.value)}
              />
            </div>
          </div>
        );

      case 'db_insert':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Gdzie zapisać dane?</label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.table || 'users'}
                onChange={(e) => updateNodeConfig('table', e.target.value)}
              >
                <option value="users">Tabela Użytkowników</option>
                <option value="logs">Dziennik zdarzeń (Logs)</option>
                <option value="orders">Baza Zamówień</option>
              </select>
            </div>
          </div>
        );

      // Formularz wysyłki e-mail
      case 'send_email':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Odbiorca (Adres e-mail)</label>
              <input
                type="text"
                placeholder="np. biuro@firma.pl"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.recipient || ''}
                onChange={(e) => updateNodeConfig('recipient', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Temat wiadomości</label>
              <input
                type="text"
                placeholder="np. Masz nowe zamówienie!"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.subject || ''}
                onChange={(e) => updateNodeConfig('subject', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Treść maila</label>
              <textarea
                placeholder="Wpisz treść wiadomości, którą chcesz wysłać..."
                rows={5}
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.body || ''}
                onChange={(e) => updateNodeConfig('body', e.target.value)}
              />
            </div>
            
            <div className="p-3 mt-4 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                System użyje globalnych ustawień SMTP z zakładki <span className="font-semibold text-foreground">Settings</span> do wysłania tej wiadomości.
              </p>
            </div>
          </div>
        );

      // Formularz zewnętrznego zapytania HTTP
      case 'http_request':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Metoda i Adres URL zewnętrznego API</label>
              <div className="flex gap-2">
                <select
                  className="w-1/3 text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                  value={config.method || 'GET'}
                  onChange={(e) => updateNodeConfig('method', e.target.value)}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <input
                  type="text"
                  placeholder="https://api.system.pl/v1/..."
                  className="w-2/3 text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={config.url || ''}
                  onChange={(e) => updateNodeConfig('url', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Nagłówki (np. Token Autoryzacji w JSON)</label>
              <textarea
                placeholder='{"Authorization": "Bearer TOKEN"}'
                rows={2}
                className="w-full font-mono text-xs border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.headers || ''}
                onChange={(e) => updateNodeConfig('headers', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Dane do wysłania (Payload JSON)</label>
              <textarea
                placeholder='{"status": "zakończony"}'
                rows={3}
                className="w-full font-mono text-xs border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.body || ''}
                onChange={(e) => updateNodeConfig('body', e.target.value)}
              />
            </div>
          </div>
        );

      // Formularz opóźnienia czasowego
      case 'delay':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Zatrzymaj proces na czas</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="np. 15"
                  min="0"
                  className="w-1/2 text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={config.value || ''}
                  onChange={(e) => updateNodeConfig('value', e.target.value)}
                />
                <select
                  className="w-1/2 text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                  value={config.unit || 'minutes'}
                  onChange={(e) => updateNodeConfig('unit', e.target.value)}
                >
                  <option value="seconds">Sekundy</option>
                  <option value="minutes">Minuty</option>
                  <option value="hours">Godziny</option>
                  <option value="days">Dni</option>
                </select>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Po upłynięciu wskazanego czasu proces automatycznie wznowi działanie w tle.</p>
            </div>
          </div>
        );

      // Formularz transformacji i filtrowania JSON
      case 'json_transform':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Zostaw tylko wybrane pola z poprzedniego kroku</label>
              <input
                type="text"
                placeholder="np. id_klienta, kwota, status"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.keys || ''}
                onChange={(e) => updateNodeConfig('keys', e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Wypisz po przecinku pola JSON, które mają zostać przekazane dalej. Reszta zostanie odrzucona (odchudzenie payloadu).</p>
            </div>
          </div>
        );

      default:
        return <p className="text-sm text-muted-foreground text-center mt-8">Brak dodatkowych opcji konfiguracji dla tego klocka.</p>;
    }
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
          <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors">
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
                        onDragStart={(e) => onDragStart(e, item.type, item.subtype, item.label, item.description)}
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

        <div className="flex-1 relative flex">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            isValidConnection={isValidConnection}
            fitView
            defaultEdgeOptions={{
              style: { strokeWidth: 2, stroke: '#94a3b8' },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
            <Controls />
          </ReactFlow>

          {selectedNode && (
            <aside className="w-80 bg-white border-l border-border flex flex-col absolute right-0 top-0 bottom-0 z-10 shadow-2xl transition-all">
              <div className="px-4 py-4 border-b border-border flex justify-between items-center bg-muted/20">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Konfiguracja</h3>
                </div>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="text-muted-foreground hover:text-red-500 p-1 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="p-4 border-b border-border bg-muted/10">
                 <p className="text-xs font-semibold text-primary uppercase tracking-wider">{selectedNode.data.label as string}</p>
                 <p className="text-xs text-muted-foreground mt-1">ID klocka: {selectedNode.id}</p>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {renderConfigForm()}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}