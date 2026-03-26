import { Handle, Position } from '@xyflow/react';

interface NodeData {
  label?: string;
  description?: string;
}

export default function LogicNode({ data }: { data: NodeData }) {
  return (
    <div className="bg-logic-light border border-logic/40 rounded-xl p-4 shadow-sm min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-logic border-2 border-white" />
      <div className="font-semibold text-logic text-sm">{data.label}</div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Kieruje ruchem'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-logic border-2 border-white" />
    </div>
  );
}