import StatusBar from './StatusBar';
import CharacterSection from './CharacterSection';
import SessionSection from './SessionSection';
import './Sidebar.css';

interface SidebarProps {
  onSessionSelect: (id: string) => void;
  onClose: () => void;
}

export default function Sidebar({ onSessionSelect, onClose }: SidebarProps) {
  return (
    <aside id="sidebar">
      <button className="sidebar-close-btn" onClick={onClose} aria-label="关闭侧边栏">
        ✕
      </button>
      <StatusBar />
      <CharacterSection />
      <SessionSection onSessionSelect={onSessionSelect} />
    </aside>
  );
}
