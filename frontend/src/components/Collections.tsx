import { useEffect, useMemo, useState } from 'react';
import { Database, Plus } from 'lucide-react';
import {
  createCollection,
  createCollectionRecord,
  listCollectionRecords,
  listCollections,
  type CollectionRecord,
  type CollectionSummary,
} from '../api/collections';

export default function Collections() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [records, setRecords] = useState<CollectionRecord[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newRecordJson, setNewRecordJson] = useState('{\n  "example_key": "example_value"\n}');
  const [loading, setLoading] = useState(false);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) || null,
    [collections, selectedCollectionId]
  );

  const loadCollections = async () => {
    const data = await listCollections();
    setCollections(data);
    if (!selectedCollectionId && data.length > 0) {
      setSelectedCollectionId(data[0].id);
    }
  };

  const loadRecords = async (collectionId: string) => {
    if (!collectionId) {
      setRecords([]);
      return;
    }
    const data = await listCollectionRecords(collectionId);
    setRecords(data);
  };

  useEffect(() => {
    void loadCollections();
  }, []);

  useEffect(() => {
    void loadRecords(selectedCollectionId);
  }, [selectedCollectionId]);

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    setLoading(true);
    try {
      const created = await createCollection(newCollectionName.trim());
      setNewCollectionName('');
      await loadCollections();
      setSelectedCollectionId(created.id);
    } catch (error) {
      alert('Nie udało się utworzyć kolekcji.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCollectionId) return;
    setLoading(true);
    try {
      const parsed = JSON.parse(newRecordJson) as Record<string, unknown>;
      await createCollectionRecord(selectedCollectionId, parsed);
      await loadRecords(selectedCollectionId);
    } catch (error) {
      alert('Nie udało się zapisać rekordu (sprawdź JSON).');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Kolekcje</h1>
        <p className="text-muted-foreground mt-1">Wbudowane kolekcje rekordów (Airtable/Strapi-like)</p>
      </header>

      <div className="p-8 grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 xl:col-span-1">
          <h2 className="text-sm font-semibold text-foreground mb-4">Nowa kolekcja</h2>
          <form className="space-y-3" onSubmit={handleCreateCollection}>
            <input
              type="text"
              placeholder="np. Leads CRM"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Utwórz kolekcję
            </button>
          </form>

          <div className="mt-6 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Wybierz kolekcję
            </label>
            <select
              className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 bg-white"
              value={selectedCollectionId}
              onChange={(e) => setSelectedCollectionId(e.target.value)}
            >
              <option value="">-- brak --</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm p-5 xl:col-span-1">
          <h2 className="text-sm font-semibold text-foreground mb-4">Dodaj rekord</h2>
          {!selectedCollection ? (
            <p className="text-sm text-muted-foreground">Najpierw wybierz kolekcję.</p>
          ) : (
            <form className="space-y-3" onSubmit={handleCreateRecord}>
              <p className="text-xs text-muted-foreground">
                Kolekcja: <span className="font-semibold text-foreground">{selectedCollection.name}</span>
              </p>
              <textarea
                value={newRecordJson}
                onChange={(e) => setNewRecordJson(e.target.value)}
                rows={10}
                className="w-full font-mono text-xs border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md border border-border py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Zapisz rekord
              </button>
            </form>
          )}
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm p-5 xl:col-span-1">
          <h2 className="text-sm font-semibold text-foreground mb-4">Podgląd rekordów</h2>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak rekordów do wyświetlenia.</p>
            ) : (
              records.map((record) => (
                <div key={record.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-3.5 h-3.5 text-primary" />
                    <p className="text-[11px] font-semibold text-muted-foreground">{record.id}</p>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap break-all text-foreground">
                    {JSON.stringify(record.data, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
