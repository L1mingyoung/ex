import { useAppContext } from '../../context/AppContext';
import { useTheme } from '../../hooks/useTheme';

interface ChatHeaderProps {
  onMenuClick: () => void;
}

export default function ChatHeader({ onMenuClick }: ChatHeaderProps) {
  const { state } = useAppContext();
  const { theme, toggleTheme } = useTheme();

  const currentCharacter = state.characters.find(
    (c) => c.id === state.currentCharacterId,
  );
  const currentSession = state.sessions.find(
    (s) => s.id === state.currentSessionId,
  );

  let title = '选择一个会话开始聊天';
  if (currentSession) {
    title = currentSession.title || '新对话';
    if (currentCharacter) {
      title = `${currentCharacter.name} · ${title}`;
    }
  } else if (currentCharacter) {
    title = `${currentCharacter.name} · 选择会话`;
  }

  return (
    <div id="chat-header">
      <button className="menu-btn" onClick={onMenuClick} aria-label="打开菜单">
        <span className="menu-icon" />
      </button>
      <h2>{title}</h2>
      {state.isStreaming && <span className="streaming-indicator" />}
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}
        title={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}
      >
        {theme === 'dark' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </div>
  );
}
