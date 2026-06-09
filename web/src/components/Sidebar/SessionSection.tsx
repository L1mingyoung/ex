import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../Toast';
import SessionItem from './SessionItem';
import ImportModal from './ImportModal';

interface SessionSectionProps {
  onSessionSelect: (id: string) => void;
}

export default function SessionSection({ onSessionSelect }: SessionSectionProps) {
  const { state, createSession, deleteSession } = useAppContext();
  const { toast } = useToast();
  const [showImport, setShowImport] = useState(false);

  const filtered = state.currentCharacterId
    ? state.sessions.filter((s) => s.characterId === state.currentCharacterId)
    : state.sessions;

  const handleDelete = async (id: string) => {
    if (!confirm('删除这个会话？')) return;
    try {
      await deleteSession(id);
      toast('会话已删除', 'success');
    } catch (err) {
      toast('删除失败: ' + (err as Error).message, 'error');
    }
  };

  const handleSelect = (id: string) => {
    onSessionSelect(id);
  };

  return (
    <div id="sessions-section">
      <div className="sessions-actions">
        <button
          id="new-session-btn"
          disabled={!state.currentCharacterId}
          onClick={createSession}
        >
          + 新建会话
        </button>
        <button
          id="import-btn"
          disabled={!state.currentSessionId}
          onClick={() => setShowImport(true)}
          title="导入聊天记录"
        >
          导入
        </button>
      </div>
      <div id="session-list">
        {filtered.length === 0 && state.currentCharacterId && (
          <p className="empty-hint">暂无会话，点击上方新建</p>
        )}
        {filtered.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === state.currentSessionId}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
