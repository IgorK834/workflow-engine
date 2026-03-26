import { Handle, Position } from '@xyflow/react';

interface NodeData {
  label?: string;
  description?: string;
}

export default function ActionNode({ data }: { data: NodeData }) {
  return (
    <div className="bg-action-light border border-action/40 rounded-xl p-4 shadow-sm min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-action border-2 border-white" />
      <div className="font-semibold text-action text-sm">{data.label}</div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Wykonuje zadanie'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-action border-2 border-white" />
    </div>
  );
}