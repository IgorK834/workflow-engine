import {
  Activity,
  CheckCircle2,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { useMemo } from 'react';
import { useWorkflows } from '../hooks/useWorkflows';

type ExecutionStatus = 'success' | 'running' | 'error';

interface KpiCard {
  title: string;
  value: string;
  hint: string;
  icon: typeof Activity;
  color: string;
  bgColor: string;
}

interface RecentExecution {
  id: number;
  name: string;
  status: ExecutionStatus;
  time: string;
  duration: string;
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const styles = {
    success: 'bg-success/10 text-success',
    running: 'bg-primary/10 text-primary',
    error: 'bg-error/10 text-error',
  };
  const labels = {
    success: 'Sukces',
    running: 'W toku',
    error: 'Blad',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function Dashboard() {
  const { workflows, isLoading, error, reload } = useWorkflows();

  const kpiCards = useMemo<KpiCard[]>(
    () => [
      {
        title: 'Aktywne procesy',
        value: String(workflows.filter((wf) => wf.is_active).length),
        hint: 'Na podstawie rekordów z bazy',
        icon: Activity,
        color: 'text-primary',
        bgColor: 'bg-primary/10',
      },
      {
        title: 'Wszystkie workflow',
        value: String(workflows.length),
        hint: 'Łączna liczba definicji',
        icon: CheckCircle2,
        color: 'text-success',
        bgColor: 'bg-success/10',
      },
    ],
    [workflows]
  );

  const recentExecutions = useMemo<RecentExecution[]>(
    () =>
      workflows
        .slice()
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice(0, 8)
        .map((wf, index) => ({
          id: index + 1,
          name: wf.name,
          status: wf.is_active ? 'running' : 'success',
          time: new Date(wf.updated_at).toLocaleString('pl-PL'),
          duration: '-',
        })),
    [workflows]
  );

  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Podsumowanie procesów automatyzacji</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            Ostatnia aktualizacja: {new Date().toLocaleTimeString('pl-PL')}
          </div>
        </div>
      </header>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="bg-white rounded-xl border border-border p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                  <TrendingUp className="w-4 h-4 text-success" />
                </div>
                <p className="text-2xl font-semibold text-foreground">{card.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{card.title}</p>
                <p className="text-xs text-muted-foreground mt-2">{card.hint}</p>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-foreground">Ostatnie wykonania</h3>
              <button
                onClick={() => void reload()}
                className="text-sm font-medium text-primary hover:text-primary/90 transition-colors"
              >
                Odswież
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Nazwa procesu
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Czas wykonania
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Kiedy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td className="px-6 py-8 text-sm text-muted-foreground" colSpan={4}>
                      Ładowanie danych...
                    </td>
                  </tr>
                )}
                {error && !isLoading && (
                  <tr>
                    <td className="px-6 py-8 text-sm text-error" colSpan={4}>
                      Błąd API: {error}
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !error &&
                  recentExecutions.map((execution) => (
                    <tr key={execution.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-foreground">{execution.name}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={execution.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{execution.duration}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{execution.time}</td>
                    </tr>
                  ))}
                {!isLoading && !error && recentExecutions.length === 0 && (
                  <tr>
                    <td className="px-6 py-8 text-sm text-muted-foreground" colSpan={4}>
                      Brak danych. Dodaj workflow lub uruchom backend API.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
