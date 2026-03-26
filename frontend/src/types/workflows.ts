export interface WorkflowNodeData {
  subtype: string;
  label: string;
  config: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'logic' | 'action';
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  graph_json: WorkflowGraph;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
