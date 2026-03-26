export default function Monitoring() {
  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Monitoring</h1>
        <p className="text-muted-foreground mt-1">Moduł gotowy pod integracje z telemetrią i metrykami z bazy</p>
      </header>
      <div className="p-8">
        <div className="bg-white rounded-xl border border-border p-6 text-sm text-muted-foreground">
          Brak endpointu monitoringu. Podłącz dane z API, np. /api/v1/metrics, aby wyswietlić wykresy i alerty.
        </div>
      </div>
    </div>
  );
}
