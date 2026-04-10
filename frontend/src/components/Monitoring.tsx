import { useEffect, useState } from 'react';
import { listExecutions } from '../api/workflows';
import { Eye, Activity } from 'lucide-react';
import ExecutionViewer from './ExecutionViewer';

export default function Monitoring() {
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [viewingExecution, setViewingExecution] = useState<{workflowId: string, executionId: string} | null>(null);

  const fetchExecutions = async () => {
    try {
      setLoading(true);
      const data = await listExecutions();
      setExecutions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExecutions();
  }, []);

  if (viewingExecution) {
    return (
      <ExecutionViewer 
        workflowId={viewingExecution.workflowId} 
        executionId={viewingExecution.executionId} 
        onClose={() => setViewingExecution(null)} 
      />
    );
  }

  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                    <Activity className="w-6 h-6 text-primary" /> Monitoring i Trace
                </h1>
                <p className="text-muted-foreground mt-1">Śledzenie historii wykonania procesów na żywo</p>
            </div>
            <button
                onClick={fetchExecutions}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
                Odśwież
            </button>
        </div>
      </header>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ID Egzekucji</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Wymuszone przez (ID)</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Rozpoczęto</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && <tr><td className="px-6 py-8 text-sm text-muted-foreground text-center" colSpan={5}>Ładowanie egzekucji...</td></tr>}
              {error && !loading && <tr><td className="px-6 py-8 text-sm text-red-500 text-center" colSpan={5}>Błąd: {error}</td></tr>}
              
              {!loading && !error && executions.length === 0 && (
                 <tr><td className="px-6 py-8 text-sm text-muted-foreground text-center" colSpan={5}>Brak uruchomień do wyświetlenia.</td></tr>
              )}

              {!loading && !error && executions.map((exec) => (
                <tr key={exec.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 text-sm font-mono text-muted-foreground truncate max-w-[150px]">{exec.id.substring(0, 13)}...</td>
                    <td className="px-6 py-4 text-sm font-mono text-muted-foreground truncate max-w-[150px]">{exec.workflow_id}</td>
                    <td className="px-6 py-4 text-sm font-medium">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            exec.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                            exec.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                            exec.status === 'PAUSED' ? 'bg-amber-100 text-amber-800' :
                            'bg-blue-100 text-blue-800'
                        }`}>
                            {exec.status}
                        </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                        {new Date(exec.started_at).toLocaleString('pl-PL')}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium">
                        <button
                            onClick={() => setViewingExecution({ workflowId: exec.workflow_id, executionId: exec.id })}
                            className="text-primary hover:text-primary/80 hover:bg-primary/10 p-2 rounded-md transition-colors inline-flex items-center gap-1"
                            title="Zobacz przebieg na grafie"
                        >
                            <Eye className="w-4 h-4" /> Trace
                        </button>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}