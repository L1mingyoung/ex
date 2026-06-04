import StatusBar from './StatusBar';
import CharacterSection from './CharacterSection';
import SessionSection from './SessionSection';
import './Sidebar.css';

export default function Sidebar() {
  return (
    <aside id="sidebar">
      <StatusBar />
      <CharacterSection />
      <SessionSection />
    </aside>
  );
}
