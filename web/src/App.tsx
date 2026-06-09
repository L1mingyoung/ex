import { useEffect, useState } from 'react';
import ChatArea from './components/ChatArea/ChatArea';
import Sidebar from './components/Sidebar/Sidebar';
import { ToastProvider } from './components/Toast';
import { AppProvider, useAppContext } from './context/AppContext';
import { useTheme } from './hooks/useTheme';

function AppContent() {
  const { loadCharacters, loadSessions, selectSession } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useTheme();

  useEffect(() => {
    loadCharacters();
    loadSessions();
  }, [loadCharacters, loadSessions]);

  const handleSelectSession = (id: string) => {
    selectSession(id);
    setSidebarOpen(false);
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-overlay" onClick={closeSidebar} />
      <Sidebar onSessionSelect={handleSelectSession} onClose={closeSidebar} />
      <ChatArea onMenuClick={() => setSidebarOpen(true)} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AppProvider>
  );
}
