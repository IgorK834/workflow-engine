import { Handle, Position, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';

interface NodeData {
  label?: string;
  description?: string;
  subtype?: string;
  config?: any;
}

export default function LogicNode({ id, data }: { id: string, data: NodeData }) {
    const { setNodes, setEdges } = useReactFlow();

    const handleDelete = () => {
        setNodes((nodes) => nodes.filter((n) => n.id !== id));
        setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id));
    }
    
    const isSwitch = data.subtype === 'switch';
    const cases = data.config?.cases || [];

  return (
    <div className="bg-logic-light border border-logic/40 rounded-xl p-4 shadow-sm min-w-[200px] relative group">
        <button
        onClick={handleDelete}
        className="absolute -top-2 -right-2 bg-white text-muted-foreground hover:text-red-500 border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
        title="Usuń"
        >
            <X className='w-3 h-3' />
        </button>
        
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-logic border-2 border-white" />
      <div className="font-semibold text-logic text-sm">{data.label}</div>
      <div className="text-muted-foreground text-xs mt-1">{data.description || 'Kieruje ruchem'}</div>
      
      {/* Standardowe wyjście dla zwykłych bramek */}
      {!isSwitch && (
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-logic border-2 border-white" />
      )}

      {/* Dynamiczne wyjścia dla bramki Switch */}
      {isSwitch && (
        <div className="mt-4 flex flex-col gap-3 relative">
            {cases.map((c: any) => (
                <div key={c.id} className="text-right text-[10px] text-muted-foreground pr-2 relative h-4">
                    <span className="bg-white/50 px-1 rounded">{c.operator} {c.value}</span>
                    <Handle 
                        type="source" 
                        id={c.id} 
                        position={Position.Right} 
                        className="w-3 h-3 bg-logic border-2 border-white -right-5 absolute top-1/2 -translate-y-1/2" 
                    />
                </div>
            ))}
            <div className="text-right text-[10px] text-muted-foreground pr-2 relative h-4 mt-2">
                <span className="font-semibold text-gray-500">default</span>
                <Handle 
                    type="source" 
                    id="default" 
                    position={Position.Right} 
                    className="w-3 h-3 bg-gray-400 border-2 border-white -right-5 absolute top-1/2 -translate-y-1/2" 
                />
            </div>
        </div>
      )}
    </div>
  );
}