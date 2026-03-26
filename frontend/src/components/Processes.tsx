import { useWorkflows } from '../hooks/useWorkflows';

export default function Processes() {
  const { workflows, isLoading, error, reload } = useWorkflows();

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
            Odswiez
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
                workflows.map((wf) => (
                  <tr key={wf.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-foreground">{wf.name}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{wf.description || '-'}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {wf.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(wf.updated_at).toLocaleString('pl-PL')}
                    </td>
                  </tr>
                ))}
              {!isLoading && !error && workflows.length === 0 && (
                <tr>
                  <td className="px-6 py-8 text-sm text-muted-foreground" colSpan={4}>
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
