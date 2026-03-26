import { useCallback, useEffect, useState } from 'react';
import { listWorkflows } from '../api/workflows';
import type { Workflow } from '../types/workflows';

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listWorkflows();
      setWorkflows(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown API error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { workflows, isLoading, error, reload };
}
