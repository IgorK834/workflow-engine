import type { Workflow } from '../types/workflows';

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

export async function createWorkflow(workflowData: any): Promise<Workflow> {
  return apiRequest<Workflow>('/workflows/', {
    method: 'POST',
    body: JSON.stringify(workflowData),
  })
}

export async function listWorkflows(): Promise<Workflow[]> {
  return apiRequest<Workflow[]>('/workflows/');
}

export async function executeWorkflowTest(workflowId: string): Promise<any> {
  return apiRequest<any>(`/workflows/${workflowId}/execute`, {method: 'POST'});
}

export async function publishWorkflow(workflowId: string): Promise<Workflow> {
  return apiRequest<Workflow>(`/workflows/${workflowId}/publish`, {method: 'PUT'});
}

export async function deleteWorkflow(workflowId: string): Promise<any> {
  return apiRequest<any>(`/worfklows/${workflowId}`, {method: 'DELETE'});
}