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
  FileJson,
  Copy,
  Trello
} from 'lucide-react';
import TriggerNode from '../nodes/TriggerNode';
import LogicNode from '../nodes/LogicNode';
import ActionNode from '../nodes/ActionNode';
import { createWorkflow, executeWorkflowTest, publishWorkflow } from '../api/workflows';
import { useWorkflows } from '../hooks/useWorkflows';

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
    items: [
      { type: 'trigger', subtype: 'webhook', label: 'Odbierz Webhook', icon: Webhook, description: 'HTTP endpoint' },
      { type: 'trigger', subtype: 'receive_email', label: 'Odbierz Email', icon: Mail, description: 'Oczekuje na maile'},
      { type: 'trigger', subtype: 'schedule', label: 'Harmonogram (Cron)', icon: Clock, description: 'Uruchamia cyklicznie' },
    ],
  },
  {
    category: 'Bramki logiczne i Narzędzia',
    items: [
      { type: 'logic', subtype: 'if_else', label: 'Jeśli / To (Warunek)', icon: GitBranch, description: 'Rozgałęzienie' },
      { type: 'logic', subtype: 'delay', label: 'Opóźnienie czasowe', icon: Clock, description: 'Pause & Resume (Baza)' },
      { type: 'logic', subtype: 'json_transform', label: 'Filtruj Dane', icon: FileJson, description: 'Wybiera tylko wybrane pola' },
      { type: 'logic', subtype: 'switch', label: 'Switch (Wiele sciezek)', icon: GitBranch, description: 'WIelokrotne rozgałęzienie'},
      { type: 'logic', subtype: 'for_each', label: 'Pętla (For Each)', icon: GitBranch, description: 'Uruchamia podprocesy' },
    ],
  },
  {
    category: 'Akcje',
    items: [
      { type: 'action', subtype: 'slack_msg', label: 'Wyślij na Slack', icon: MessageSquare, description: 'Powiadomienie' },
      { type: 'action', subtype: 'send_email', label: 'Wyślij Email', icon: Mail, description: 'Wiadomość z systemu' },
      { type: 'action', subtype: 'http_request', label: 'Zewnętrzny Webhook API', icon: Globe, description: 'Request HTTP (GET/POST)' },
      { type: 'action', subtype: 'db_insert', label: 'Zapisz do Bazy', icon: Database, description: 'INSERT/UPDATE' },
      { type: 'action', subtype: 'data_mapper', label: 'Mapowanie Danych', icon: FileJson, description: 'Transformacja JSON' },
      { type: 'action', subtype: 'jira_create_ticket', label: 'Jira: Utwórz Ticket', icon: Trello, description: 'Tworzy zgłoszenie w JIRA' },
    ],
  },
];

export default function WorkflowEditor({ onBack }: WorkflowEditorProps) {
  const { workflows } = useWorkflows();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(null)

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
  const updateNodeConfig = (key: string, value: any) => {
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
      const response = await createWorkflow(payload);
      setSavedWorkflowId(response.id);
      alert('Proces pomyślnie zapisany!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas zapisu do bazy danych!');
    }
  };

  const handleTest = async () => {
    if (!savedWorkflowId) {
      alert('Najpierw zapisz proces, aby móc go przetestować!');
      return;
    }
    
    try {
      await executeWorkflowTest(savedWorkflowId);
      alert('Test procesu uruchomiony pomyślnie!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas uruchamiania testu procesu!');
    }
  };

  const handlePublish = async () => {
    if (!savedWorkflowId) {
      alert('Najpierw zapisz proces, aby móc go opublikować!');
      return;
    }
    
    try {
      await publishWorkflow(savedWorkflowId);
      alert('Proces został pomyślnie opublikowany!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas publikacji procesu!');
    }
  };

  // Switch generujący formularz pod konkretny typ klocka
  const renderConfigForm = () => {
    if (!selectedNode) return null;
    const subtype = selectedNode.data.subtype as string;
    const config = (selectedNode.data.config as Record<string, any>) || {};

    switch (subtype) {
      case 'webhook':
        const webhookUrl = `http://localhost:8000/api/v1/workflows/${savedWorkflowId || '{ID_PROCESU}'}/trigger`;
        return (
          <div className="space-y-4">
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="text-sm font-semibold text-foreground mb-2">Twój adres Webhook</h4>
              <div className="flex items-center gap-2 mb-3">
                <div className="bg-white p-2 flex-1 border border-border rounded-md text-[10px] font-mono text-muted-foreground overflow-x-auto shadow-sm whitespace-nowrap">
                  [POST] {webhookUrl}
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    alert("Skopiowano do schowka!");
                  }}
                  className="p-2 bg-white border border-border rounded-md hover:bg-muted transition-colors text-foreground shadow-sm shrink-0"
                  title="Kopiuj URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                Zapisz proces, a następnie użyj powyższego adresu w systemie zewnętrznym.
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
      case 'http_request': {
        const headersList = config.headers || [];
        const paramsList = config.query_params || [];
        
        const addListItem = (keyName: string, list: any[]) => {
          updateNodeConfig(keyName, [...list, { id: Date.now(), key: '', value: '' }]);
        };
        const updateListItem = (keyName: string, list: any[], idx: number, field: string, val: string) => {
          const newList = [...list];
          newList[idx] = { ...newList[idx], [field]: val };
          updateNodeConfig(keyName, newList);
        };
        const removeListItem = (keyName: string, list: any[], idx: number) => {
          updateNodeConfig(keyName, list.filter((_: any, i: number) => i !== idx));
        };

        const renderDynamicList = (title: string, configKey: string, list: any[]) => (
          <div className="space-y-2 mt-4 border-t border-border pt-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-foreground">{title}</label>
              <button onClick={() => addListItem(configKey, list)} className="text-xs text-primary hover:underline">+ Dodaj</button>
            </div>
            {list.map((item: any, idx: number) => (
              <div key={item.id || idx} className="flex gap-2 items-center">
                <input type="text" placeholder="Klucz" className="w-1/3 text-xs p-1.5 border rounded" value={item.key} onChange={(e) => updateListItem(configKey, list, idx, 'key', e.target.value)} />
                <input type="text" placeholder="Wartość" className="w-full text-xs p-1.5 border rounded" value={item.value} onChange={(e) => updateListItem(configKey, list, idx, 'value', e.target.value)} />
                <button onClick={() => removeListItem(configKey, list, idx)} className="text-red-500 shrink-0"><X className="w-3 h-3"/></button>
              </div>
            ))}
          </div>
        );

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Metoda i Adres URL</label>
              <div className="flex gap-2">
                <select className="w-1/3 text-sm border-border rounded-md border p-2 focus:outline-none bg-white" value={config.method || 'GET'} onChange={(e) => updateNodeConfig('method', e.target.value)}>
                  <option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option>
                </select>
                <input type="text" placeholder="https://api.com/v1/..." className="w-2/3 text-sm border-border rounded-md border p-2" value={config.url || ''} onChange={(e) => updateNodeConfig('url', e.target.value)} />
              </div>
            </div>

            {renderDynamicList("Parametry URL (Query)", "query_params", paramsList)}
            {renderDynamicList("Nagłówki (Headers)", "headers", headersList)}

            {['POST', 'PUT', 'PATCH'].includes(config.method || 'GET') && (
              <div className="space-y-2 mt-4 border-t border-border pt-4">
                <label className="text-sm font-medium text-foreground">Typ Payloadu (Body)</label>
                <select className="w-full text-sm border-border rounded-md border p-2 bg-white mb-2" value={config.body_type || 'raw'} onChange={(e) => updateNodeConfig('body_type', e.target.value)}>
                  <option value="raw">Raw (np. czysty JSON wklejony z palca)</option>
                  <option value="json">Formularz JSON (Klucz-Wartość)</option>
                </select>
                
                {(!config.body_type || config.body_type === 'raw') ? (
                  <textarea placeholder='{"key": "{{variable}}"}' rows={4} className="w-full font-mono text-xs border rounded-md p-2" value={typeof config.body === 'string' ? config.body : ''} onChange={(e) => updateNodeConfig('body', e.target.value)} />
                ) : (
                  renderDynamicList("Pola Body", "body", Array.isArray(config.body) ? config.body : [])
                )}
              </div>
            )}
          </div>
        );
      }

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

      // Formularz oczekiwania na wiadomość email
      case 'receive_email':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Filtruj Nadawcę (Opcjonalnie)</label>
              <input
                type="text"
                placeholder="np. faktury@firma.pl"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.from_filter || ''}
                onChange={(e) => updateNodeConfig('from_filter', e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Uruchom tylko jeśli nadawca zawiera ten tekst.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Filtruj Temat (Opcjonalnie)</label>
              <input
                type="text"
                placeholder="np. Awaria systemu"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.subject_filter || ''}
                onChange={(e) => updateNodeConfig('subject_filter', e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Uruchom tylko jeśli temat zawiera ten tekst.</p>
            </div>
            <div className="p-3 mt-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                Ten proces uruchomi się automatycznie dla nowych wiadomości przy użyciu globalnej konfiguracji <span className="font-semibold text-primary">IMAP</span> z panelu Settings.
              </p>
            </div>
          </div>
        );
      
      // Formularz harmonogramu wykonywania akcji
      case 'schedule':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Typ harmonogramu</label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.schedule_type || 'interval'}
                onChange={(e) => updateNodeConfig('schedule_type', e.target.value)}
              >
                <option value="interval">Interwał (np. co X minut)</option>
                <option value="cron">Wyrażenie Cron</option>
              </select>
            </div>

            {(!config.schedule_type || config.schedule_type === 'interval') && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Co ile uruchamiać?</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="np. 15"
                    className="w-1/2 text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={config.interval_value || '15'}
                    onChange={(e) => updateNodeConfig('interval_value', e.target.value)}
                  />
                  <select
                    className="w-1/2 text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                    value={config.interval_unit || 'minutes'}
                    onChange={(e) => updateNodeConfig('interval_unit', e.target.value)}
                  >
                    <option value="minutes">Minut</option>
                    <option value="hours">Godzin</option>
                    <option value="days">Dni</option>
                  </select>
                </div>
              </div>
            )}

            {config.schedule_type === 'cron' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Wyrażenie Cron</label>
                <input
                  type="text"
                  placeholder="np. 0 8 * * *"
                  className="w-full text-sm font-mono border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={config.cron_expression || '0 8 * * *'}
                  onChange={(e) => updateNodeConfig('cron_expression', e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Przykład: <code>0 8 * * *</code> oznacza codziennie o 8:00 UTC.
                </p>
              </div>
            )}
            <div className="p-3 mt-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                Harmonogram jest weryfikowany na serwerze i automatycznie synchronizowany po zapisaniu procesu.
              </p>
            </div>
          </div>
        );

      // Formularz węzła Switch
      case 'switch': {
        const cases = config.cases || [];
        
        const addCase = () => {
          const newCases = [...cases, { id: `case_${Date.now()}`, operator: 'equals', value: '' }];
          updateNodeConfig('cases', newCases);
        };
        
        const updateCase = (idx: number, field: string, val: string) => {
          const newCases = [...cases];
          newCases[idx] = { ...newCases[idx], [field]: val };
          updateNodeConfig('cases', newCases);
        };
        
        const removeCase = (idx: number) => {
          const newCases = cases.filter((_: any, i: number) => i !== idx);
          updateNodeConfig('cases', newCases);
        };
        
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Zmienna wejściowa do sprawdzenia</label>
              <input
                type="text"
                placeholder="np. status_zamowienia"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.variable || ''}
                onChange={(e) => updateNodeConfig('variable', e.target.value)}
              />
            </div>
            
            <div className="space-y-3 mt-4">
              <label className="text-sm font-medium text-foreground">Ścieżki i warunki</label>
              {cases.map((c: any, idx: number) => (
                <div key={c.id} className="p-3 border border-border rounded-md bg-white space-y-2 relative shadow-sm">
                  <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-primary">Wyjście: {c.id}</span>
                      <button onClick={() => removeCase(idx)} className="text-red-500 hover:text-red-700 bg-red-50 p-1 rounded transition-colors shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                  </div>
                  <select
                    className="w-full text-xs border-border rounded-md shadow-sm border p-2 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                    value={c.operator || 'equals'}
                    onChange={(e) => updateCase(idx, 'operator', e.target.value)}
                  >
                    <option value="equals">Jest równe dokładnie</option>
                    <option value="greater">Jest większe niż</option>
                    <option value="less">Jest mniejsze niż</option>
                    <option value="contains">Zawiera tekst</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Wartość (np. 100 lub 'Opłacone')"
                    className="w-full text-xs border-border rounded-md shadow-sm p-2 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={c.value || ''}
                    onChange={(e) => updateCase(idx, 'value', e.target.value)}
                  />
                </div>
              ))}
              <button onClick={addCase} className="w-full py-2 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors">
                + Dodaj warunek
              </button>
              <div className="p-3 bg-muted/50 rounded-lg border border-border mt-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Zawsze aktywne jest również wyjście <span className="font-semibold text-foreground">default</span>, którym polecą dane, jeśli żaden z powyższych warunków nie zostanie spełniony.
                </p>
              </div>
            </div>
          </div>
        );
      }

      case 'for_each':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Zmienna tablicowa</label>
              <input
                type="text"
                placeholder="np. lista_maili"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.array_variable || ''}
                onChange={(e) => updateNodeConfig('array_variable', e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Klucz w JSON, który zawiera tablicę danych do iteracji.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Uruchom Podproces</label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.target_workflow_id || ''}
                onChange={(e) => updateNodeConfig('target_workflow_id', e.target.value)}
              >
                <option value="">-- Wybierz docelowy workflow --</option>
                {workflows?.map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">Dla każdego elementu z tablicy zostanie osobno uruchomiony wybrany proces.</p>
            </div>
          </div>
        );
      
      case 'data_mapper': {
        const mappings = config.mappings || [];
        
        const addMapping = () => {
          updateNodeConfig('mappings', [...mappings, { id: Date.now(), source: '', target: '', type: 'string' }]);
        };
        const updateMapping = (idx: number, field: string, val: string) => {
          const newMappings = [...mappings];
          newMappings[idx] = { ...newMappings[idx], [field]: val };
          updateNodeConfig('mappings', newMappings);
        };
        const removeMapping = (idx: number) => {
          updateNodeConfig('mappings', mappings.filter((_: any, i: number) => i !== idx));
        };

        return (
          <div className="space-y-4">
            <label className="text-sm font-medium text-foreground">Reguły mapowania (Z -&gt; Do)</label>
            <div className="space-y-2">
              {mappings.map((m: any, idx: number) => (
                <div key={m.id || idx} className="p-2 border border-border rounded-md bg-white space-y-2 relative shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Reguła {idx + 1}</span>
                    <button onClick={() => removeMapping(idx)} className="text-red-500 hover:text-red-700 shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <input type="text" placeholder="Źródło (np. klient.wiek)" className="w-full text-xs p-1.5 border rounded" value={m.source} onChange={(e) => updateMapping(idx, 'source', e.target.value)} />
                  <div className="flex gap-2">
                    <input type="text" placeholder="Docelowy klucz (np. age)" className="w-2/3 text-xs p-1.5 border rounded" value={m.target} onChange={(e) => updateMapping(idx, 'target', e.target.value)} />
                    <select className="w-1/3 text-xs p-1.5 border rounded bg-white" value={m.type} onChange={(e) => updateMapping(idx, 'type', e.target.value)}>
                      <option value="string">Tekst</option>
                      <option value="int">Liczba</option>
                      <option value="bool">Bool</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addMapping} className="w-full py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5">
              + Dodaj mapowanie
            </button>
          </div>
        );
      }

      default:
        return <p className="text-sm text-muted-foreground text-center mt-8">Brak dodatkowych opcji konfiguracji dla tego klocka.</p>;
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-muted/30 h-full overflow-hidden">
      <header className="bg-white border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
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
          <button onClick={handleTest} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors">
            <Play className="w-4 h-4" />
            Testuj
          </button>
          <button onClick={handlePublish} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            <Upload className="w-4 h-4" />
            Publikuj
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <aside className="w-72 bg-white border-r border-border overflow-y-auto shrink-0 h-full relative z-10">
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

        <div className="flex-1 relative h-full">
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
              <div className="px-4 py-4 border-b border-border flex justify-between items-center bg-muted/20 shrink-0">
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
              
              <div className="p-4 border-b border-border bg-muted/10 shrink-0">
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