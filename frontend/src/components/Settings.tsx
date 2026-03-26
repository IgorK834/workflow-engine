export default function Settings() {
  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Ustawienia</h1>
        <p className="text-muted-foreground mt-1">Moduł przygotowany pod zapis ustawień do bazy danych</p>
      </header>
      <div className="p-8">
        <div className="bg-white rounded-xl border border-border p-6 text-sm text-muted-foreground">
          Dodaj endpointy do odczytu i zapisu preferencji, np. /api/v1/settings.
        </div>
      </div>
    </div>
  );
}
