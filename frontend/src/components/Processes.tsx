import { Trash2 } from 'lucide-react';
import { useWorkflows } from '../hooks/useWorkflows';
import { deleteWorkflow } from '../api/workflows';

export default function Processes() {
  const { workflows, isLoading, error, reload } = useWorkflows();

  const handleDelete = async (id: string) => {
    if (window.confirm('Czy na pewno chcesz usunąć ten proces?')) {
      try {
        await deleteWorkflow(id);
        await reload();
      } catch (err) {
        console.error('Błąd usuwania:', err);
        alert('Wystąpił błąd podczas usuwania procesu!');
      }
    }
  };

  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Moje procesy</h1>
            <p className="text-muted-foreground mt-1">Lista workflow pobrana z backendu</p>
          </div>
          <button
            onClick={() => void reload()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Odswież
          </button>
        </div>
      </header>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Nazwa
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Opis
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Aktualizacja
                </th>
                <th className="text-right px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td className="px-6 py-8 text-sm text-muted-foreground text-center" colSpan={5}>
                    Ładowanie danych...
                  </td>
                </tr>
              )}
              {error && !isLoading && (
                <tr>
                  <td className="px-6 py-8 text-sm text-red-500 text-center" colSpan={5}>
                    Błąd API: {error}
                  </td>
                </tr>
              )}
              {!isLoading &&
                !error &&
                workflows.map((wf) => (
                  <tr key={wf.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 text-sm font-medium text-foreground">{wf.name}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{wf.description || '-'}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {wf.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Aktywny
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          Nieaktywny
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(wf.updated_at).toLocaleString('pl-PL')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleDelete(wf.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        title="Usuń proces"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              {!isLoading && !error && workflows.length === 0 && (
                <tr>
                  <td className="px-6 py-8 text-sm text-muted-foreground text-center" colSpan={5}>
                    Brak workflow w bazie danych.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}