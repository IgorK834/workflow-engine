import { Handle, Position } from '@xyflow/react';

export default function LogicNode({ data }: any) {
  return (
    <div className="bg-purple-50 border-2 border-purple-400 rounded-xl p-4 shadow-sm min-w-[180px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-purple-500 border-2 border-white" />
      <div className="font-bold text-purple-800 text-sm">{data.label}</div>
      <div className="text-gray-500 text-xs mt-1">{data.description || 'Kieruje ruchem'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-purple-500 border-2 border-white" />
    </div>
  );
}