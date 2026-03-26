import {
  LayoutDashboard,
  GitBranch,
  Activity,
  Settings,
  Plus,
  Workflow,
} from 'lucide-react';

interface SidebarProps {
  currentView: 'dashboard' | 'editor' | 'processes' | 'monitoring' | 'settings';
  onNavigate: (view: 'dashboard' | 'editor' | 'processes' | 'monitoring' | 'settings') => void;
}

const navItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'processes' as const, label: 'Moje procesy', icon: GitBranch },
  { id: 'monitoring' as const, label: 'Monitoring', icon: Activity },
  { id: 'settings' as const, label: 'Ustawienia', icon: Settings },
];

export default function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="w-72 bg-white border-r border-border flex flex-col h-screen">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
            <Workflow className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground">Workflow Engine</span>
        </div>
      </div>

      <div className="p-4">
        <button
          onClick={() => onNavigate('editor')}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 px-4 rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Stwórz Workflow
        </button>
      </div>

      <nav className="flex-1 px-4 pb-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
