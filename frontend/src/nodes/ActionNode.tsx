import { Handle, Position, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';

interface NodeData {
  label?: string;
  description?: string;
}

export default function TriggerNode({ id, data }: { id: string, data: NodeData }) {
    const { setNodes, setEdges } = useReactFlow();

    const handleDelete = () => {
        setNodes((nodes) => nodes.filter((n) => n.id !== id));
        setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id));
    }
  return (
    <div className="bg-action-light border border-action/40 rounded-xl p-4 shadow-sm min-w-[200px] relative group">
        <button
        onClick={handleDelete}
        className="absolute -top-2 -right-2 bg-white text-muted-foreground hover:text-red-500 border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
        title="Usuń"
        >
            <X className='w-3 h-3' />
        </button>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-action border-2 border-white" />
      <div className="font-semibold text-action text-sm">{data.label}</div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Wykonuje zadanie'}</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-action border-2 border-white" />
    </div>
  );
}