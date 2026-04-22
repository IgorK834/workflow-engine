import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import WorkflowEditor from './components/WorkflowEditor';
import Processes from './components/Processes';
import Monitoring from './components/Monitoring';
import Settings from './components/Settings';
import Collections from './components/Collections';

type ViewType = 'dashboard' | 'editor' | 'processes' | 'monitoring' | 'collections' | 'settings';

function AppContent() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const handleNavigate = (view: ViewType) => {
    if (view === 'editor') {
      setSelectedWorkflowId(null);
    }
    setCurrentView(view);
  };

  const handleEditWorkflow = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setCurrentView('editor');
  };

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'editor':
        return (
          <WorkflowEditor
            workflowId={selectedWorkflowId}
            onBack={() => {
              setSelectedWorkflowId(null);
              setCurrentView('processes');
            }}
          />
        );
      case 'processes':
        return <Processes onEditWorkflow={handleEditWorkflow} />;
      case 'monitoring':
        return <Monitoring />;
      case 'collections':
        return <Collections />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar currentView={currentView} onNavigate={handleNavigate} />
      {renderContent()}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}
