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

export async function listExecutions(): Promise<any[]> {
  return apiRequest<any[]>('/workflows/executions');
}

export async function getExecutionDetails(workflowId: string, executionId: string): Promise<any> {
  return apiRequest<any>(`/workflows/${workflowId}/executions/${executionId}`);
}

export async function executeWorkflowTest(workflowId: string): Promise<any> {
  return apiRequest<any>(`/workflows/${workflowId}/execute`, {method: 'POST'});
}

export async function publishWorkflow(workflowId: string): Promise<Workflow> {
  return apiRequest<Workflow>(`/workflows/${workflowId}/publish`, {method: 'PUT'});
}

export async function deleteWorkflow(workflowId: string): Promise<any> {
  return apiRequest<any>(`/workflows/${workflowId}`, {method: 'DELETE'});
}

export async function resumeWorkflow(workflowId: string): Promise<any> {
  return apiRequest<any>(`/workflows/${workflowId}/resume`, {method: 'POST'});
}

export async function toggleWorkflow(workflowId: string): Promise<Workflow> {
  return apiRequest<Workflow>(`/workflows/${workflowId}/toggle`, { method: 'PATCH' });
}

export interface WorkflowStatsSeriesItem {
  day: string | null;
  total: number;
  completed: number;
  failed: number;
  paused: number;
  running: number;
}

export interface WorkflowStatsResponse {
  days: number;
  series: WorkflowStatsSeriesItem[];
}

export async function getWorkflowStats(days: number = 7): Promise<WorkflowStatsResponse> {
  return apiRequest<WorkflowStatsResponse>(`/workflows/stats?days=${encodeURIComponent(String(days))}`);
}

export interface WorkflowLogItem {
  id: string;
  execution_id: string;
  node_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export interface WorkflowLogsResponse {
  limit: number;
  items: WorkflowLogItem[];
}

export async function getWorkflowLogs(limit: number = 50): Promise<WorkflowLogsResponse> {
  return apiRequest<WorkflowLogsResponse>(`/workflows/logs?limit=${encodeURIComponent(String(limit))}`);
}