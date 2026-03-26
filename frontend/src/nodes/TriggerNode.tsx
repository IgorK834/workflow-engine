import { Handle, Position } from '@xyflow/react';

interface NodeData {
  label?: string;
  description?: string;
}

export default function TriggerNode({ data }: { data: NodeData }) {
  return (
    <div className="bg-trigger-light border border-trigger/40 rounded-xl p-4 shadow-sm min-w-[200px]">
      <div className="font-semibold text-trigger text-sm flex items-center gap-2">
        {data.label}
      </div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Rozpoczyna proces'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-trigger border-2 border-white" />
    </div>
  );
}