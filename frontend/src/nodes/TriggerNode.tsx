import { Handle, Position, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';

interface NodeData {
  label?: string;
  description?: string;
  executionStatus?: string;
  isReadOnly?: boolean;
}

export default function TriggerNode({ id, data }: { id: string, data: NodeData }) {
    const { setNodes, setEdges } = useReactFlow();

    const handleDelete = () => {
        if (data.isReadOnly) return;
        setNodes((nodes) => nodes.filter((n) => n.id !== id));
        setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id));
    }

    const getStatusClasses = () => {
        if (data.executionStatus === 'COMPLETED') return 'ring-2 ring-green-500 bg-green-50/50';
        if (data.executionStatus === 'FAILED') return 'ring-2 ring-red-500 bg-red-50/50';
        if (data.executionStatus === 'PAUSED') return 'ring-2 ring-amber-500 bg-amber-50/50';
        if (data.executionStatus === 'RUNNING') return 'ring-2 ring-blue-500 bg-blue-50/50';
        return '';
    };

   return (
    <div className={`bg-trigger-light border border-trigger/40 rounded-xl p-4 shadow-sm min-w-[200px] relative group ${getStatusClasses()}`}>
      {!data.isReadOnly && (
        <button
        onClick={handleDelete}
        className="absolute -top-2 -right-2 bg-white text-muted-foreground hover:text-red-500 border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
        title="Usuń"
        >
            <X className='w-3 h-3' />
        </button>
      )}
      <div className="font-semibold text-trigger text-sm flex items-center gap-2">
        {data.label}
      </div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Rozpoczyna proces'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-trigger border-2 border-white" />
    </div>
  );
}