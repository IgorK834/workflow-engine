import { Handle, Position, useReactFlow } from '@xyflow/react';
import { X, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface NodeData {
  label?: string;
  description?: string;
  subtype?: string;
  config?: any;
  executionStatus?: string;
  isReadOnly?: boolean;
}

export default function ActionNode({ id, data }: { id: string, data: NodeData }) {
    const { setNodes, setEdges } = useReactFlow();
    const [projects, setProjects] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const handleDelete = () => {
        if (data.isReadOnly) return;
        setNodes((nodes) => nodes.filter((n) => n.id !== id));
        setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id));
    };

    const updateConfig = (key: string, value: string) => {
        if (data.isReadOnly) return;
        setNodes((nds) => 
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: { ...(node.data.config as any), [key]: value }
                        }
                    };
                }
                return node;
            })
        );
    };

    const fetchProjects = async () => {
        setLoading(true);
        try {
          // Uderzamy do naszego nowego endpointu - bez parametrów, backend użyje kluczy z bazy
          const response = await fetch('http://localhost:8000/api/v1/nodes/jira/projects');
          const list = await response.json();
          setProjects(list);
        } catch (err) {
          console.error("Błąd pobierania projektów Jira", err);
          alert("Błąd połączenia. Upewnij się, że poprawnie wpisałeś poświadczenia w Ustawieniach Globalnych.");
        } finally {
          setLoading(false);
        }
    };

    const getStatusClasses = () => {
        if (data.executionStatus === 'COMPLETED') return 'ring-2 ring-green-500 bg-green-50/50';
        if (data.executionStatus === 'FAILED') return 'ring-2 ring-red-500 bg-red-50/50';
        if (data.executionStatus === 'PAUSED') return 'ring-2 ring-amber-500 bg-amber-50/50';
        if (data.executionStatus === 'RUNNING') return 'ring-2 ring-blue-500 bg-blue-50/50';
        return '';
    };

  return (
    <div className={`bg-action-light border border-action/40 rounded-xl p-4 shadow-sm min-w-[240px] relative group ${getStatusClasses()}`}>
        {!data.isReadOnly && (
            <button
            onClick={handleDelete}
            className="absolute -top-2 -right-2 bg-white text-muted-foreground hover:text-red-500 border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
            title="Usuń"
            >
                <X className='w-3 h-3' />
            </button>
        )}
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-action border-2 border-white" />
      <div className="font-semibold text-action text-sm">{data.label}</div>
      <div className="text-muted-foreground text-xs mt-1 mb-2">{data.description || 'Wykonuje zadanie'}</div>

      {/* DYNAMICZNY FORMULARZ JIRA */}
      {data.subtype === 'jira_create_ticket' && (
          <div className="mt-4 pt-3 border-t border-action/20 space-y-3">
              <button 
                  onClick={fetchProjects}
                  disabled={loading || data.isReadOnly}
                  className="w-full flex items-center justify-center gap-2 text-[10px] bg-blue-50 text-blue-600 py-1.5 rounded border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  POBIERZ PROJEKTY
              </button>

              {projects.length > 0 && (
                  <select 
                      className="w-full text-xs p-2 border rounded bg-white text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                      value={data.config?.project_key || ''}
                      onChange={(e) => updateConfig('project_key', e.target.value)}
                      disabled={data.isReadOnly}
                  >
                      <option value="">Wybierz projekt...</option>
                      {projects.map(p => <option key={p.id} value={p.key}>{p.name} ({p.key})</option>)}
                  </select>
              )}

              <select 
                  className="w-full text-xs p-2 border rounded bg-white text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                  value={data.config?.issue_type || 'Task'}
                  onChange={(e) => updateConfig('issue_type', e.target.value)}
                  disabled={data.isReadOnly}
              >
                  <option value="Task">Zadanie (Task)</option>
                  <option value="Bug">Błąd (Bug)</option>
                  <option value="Story">Story</option>
                  <option value="Epic">Epic</option>
              </select>

              <input 
                  type="text"
                  placeholder="Tytuł zgłoszenia (Summary) np. {{email.subject}}"
                  className="w-full text-xs p-2 border rounded bg-blue-50/50 font-medium disabled:opacity-50 disabled:bg-slate-50"
                  value={data.config?.summary || ''}
                  onChange={(e) => updateConfig('summary', e.target.value)}
                  disabled={data.isReadOnly}
              />
              
              <textarea 
                  placeholder="Szczegóły zgłoszenia..."
                  className="w-full text-xs p-2 border rounded bg-white min-h-[60px] disabled:opacity-50 disabled:bg-slate-50"
                  value={data.config?.description || ''}
                  onChange={(e) => updateConfig('description', e.target.value)}
                  disabled={data.isReadOnly}
              />
          </div>
      )}

      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-action border-2 border-white" />
    </div>
  );
}