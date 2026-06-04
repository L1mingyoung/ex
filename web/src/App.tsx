import { useEffect } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';

function AppContent() {
  const { loadCharacters, loadSessions } = useAppContext();

  useEffect(() => {
    loadCharacters();
    loadSessions();
  }, [loadCharacters, loadSessions]);

  return (
    <div className="app">
      <Sidebar />
      <ChatArea />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
