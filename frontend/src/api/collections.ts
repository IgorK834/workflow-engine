const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${path}`);
  }

  return (await response.json()) as T;
}

export interface CollectionSummary {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionRecord {
  id: string;
  collection_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listCollections(): Promise<CollectionSummary[]> {
  return apiRequest<CollectionSummary[]>('/collections/');
}

export async function createCollection(name: string): Promise<CollectionSummary> {
  return apiRequest<CollectionSummary>('/collections/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listCollectionRecords(collectionId: string): Promise<CollectionRecord[]> {
  return apiRequest<CollectionRecord[]>(`/collections/${collectionId}/records`);
}

export async function createCollectionRecord(
  collectionId: string,
  data: Record<string, unknown>
): Promise<CollectionRecord> {
  return apiRequest<CollectionRecord>(`/collections/${collectionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}
