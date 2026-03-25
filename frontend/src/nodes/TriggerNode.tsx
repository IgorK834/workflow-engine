import { Handle, Position } from '@xyflow/react';

export default function TriggerNode({ data }: any) {
  return (
    <div className="bg-blue-50 border-2 border-blue-400 rounded-xl p-4 shadow-sm min-w-[180px]">
      <div className="font-bold text-blue-800 text-sm flex items-center gap-2">
        {data.label}
      </div>
      <div className="text-gray-500 text-xs mt-1">{data.description || 'Rozpoczyna proces'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-blue-500 border-2 border-white" />
    </div>
  );
}