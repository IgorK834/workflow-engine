import React, { useEffect, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Clock, Activity, AlertTriangle, CheckCircle, PauseCircle } from 'lucide-react';
import { getExecutionDetails } from '../api/workflows';
import TriggerNode from '../nodes/TriggerNode';
import LogicNode from '../nodes/LogicNode';
import ActionNode from '../nodes/ActionNode';

const nodeTypes = {
  trigger: TriggerNode,
  logic: LogicNode,
  action: ActionNode,
};

interface ExecutionViewerProps {
  workflowId: string;
  executionId: string;
  onClose: () => void;
}

export default function ExecutionViewer({ workflowId, executionId, onClose }: ExecutionViewerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);
  const [selectedStep, setSelectedStep] = useState<any>(null);

  useEffect(() => {
    const loadExecution = async () => {
      try {
        setLoading(true);
        const data = await getExecutionDetails(workflowId, executionId);
        setDetails(data);

        const graphNodes = data.workflow.graph_json.nodes || [];
        const graphEdges = data.workflow.graph_json.edges || [];

        // Nakładanie statusów z bazy (ExecutionStep) do properties każdego węzła
        const mappedNodes = graphNodes.map((node: any) => {
          const step = data.steps.find((s: any) => s.node_id === node.id);
          return {
            ...node,
            data: {
              ...node.data,
              executionStatus: step ? step.status : undefined,
              isReadOnly: true
            },
            draggable: false,
          };
        });

        setNodes(mappedNodes);
        setEdges(graphEdges.map((e: any) => ({ ...e, animated: true })));
      } catch (err) {
        console.error("Błąd podczas pobierania szczegółów egzekucji", err);
      } finally {
        setLoading(false);
      }
    };
    loadExecution();
  }, [workflowId, executionId, setNodes, setEdges]);

  const onNodeClick = (_: React.MouseEvent, node: any) => {
    if (!details) return;
    const step = details.steps.find((s: any) => s.node_id === node.id);
    setSelectedStep(step || { node_id: node.id, status: 'NOT_RUN', input_data: null, output_data: null });
  };

  if (loading) {
      return (
          <div className="p-8 flex-1 flex flex-col justify-center items-center bg-muted/30">
              <Activity className="w-8 h-8 text-primary animate-pulse mb-4" />
              <div className="text-muted-foreground font-medium">Ładowanie przebiegu procesu...</div>
          </div>
      );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-muted/30">
      <header className="bg-white border-b border-border px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Trace: {details?.workflow.name}
            </h1>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
              <Activity className="w-3 h-3" /> Status ogólny: 
              <span className={`font-semibold ${details?.execution.status === 'COMPLETED' ? 'text-green-600' : details?.execution.status === 'FAILED' ? 'text-red-600' : 'text-primary'}`}>
                  {details?.execution.status}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex relative">
        <div className="flex-1 relative h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* Prawy Sidebar wyświetlający I/O wybranego kroku */}
        {selectedStep && (
          <aside className="w-96 bg-white border-l border-border h-full flex flex-col overflow-y-auto z-10 shadow-xl">
            <div className="p-4 border-b border-border flex justify-between items-center bg-muted/10">
              <h3 className="font-semibold text-foreground">Szczegóły kroku</h3>
              <button onClick={() => setSelectedStep(null)} className="text-muted-foreground hover:text-foreground text-sm font-medium">
                Zamknij
              </button>
            </div>
            
            <div className="p-5 space-y-6">
              <div>
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Status wykonania</span>
                <div className="mt-1 flex items-center gap-2 bg-slate-50 p-2 rounded border border-border">
                  {selectedStep?.status === 'COMPLETED' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {selectedStep?.status === 'FAILED' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                  {selectedStep?.status === 'PAUSED' && <PauseCircle className="w-4 h-4 text-amber-500" />}
                  <span className="font-medium text-sm">{selectedStep?.status}</span>
                </div>
              </div>

              {(selectedStep?.started_at || selectedStep?.finished_at) && (
                <div>
                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Czas i Trwanie</span>
                  <div className="mt-1 text-sm text-foreground flex items-center gap-2 bg-slate-50 p-2 rounded border border-border">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div className="text-xs">
                      {selectedStep?.started_at && <div>Start: {new Date(selectedStep?.started_at).toLocaleString('pl-PL')}</div>}
                      {selectedStep?.finished_at && <div>Koniec: {new Date(selectedStep?.finished_at).toLocaleString('pl-PL')}</div>}
                    </div>
                  </div>
                </div>
              )}

              {selectedStep?.error_message && (
                <div>
                  <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Komunikat Błędu</span>
                  <div className="mt-1 bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-200">
                    {selectedStep?.error_message}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Wejście (Input Data)</span>
                <pre className="mt-1 bg-slate-900 text-slate-50 p-3 rounded-lg text-xs overflow-x-auto border border-slate-700 shadow-inner">
                  <code>{selectedStep?.status === 'NOT_RUN' ? '{}' : selectedStep?.input_data ? JSON.stringify(selectedStep.input_data, null, 2) : 'Brak danych wejściowych (lub węzeł nie został wywołany)'}</code>
                </pre>
              </div>

              <div>
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Wyjście (Output Data)</span>
                <pre className="mt-1 bg-slate-900 text-slate-50 p-3 rounded-lg text-xs overflow-x-auto border border-slate-700 shadow-inner">
                  <code>{selectedStep?.status === 'NOT_RUN' ? '{}' : selectedStep?.output_data ? JSON.stringify(selectedStep.output_data, null, 2) : 'Brak danych wyjściowych'}</code>
                </pre>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}