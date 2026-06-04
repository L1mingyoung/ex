import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import SessionItem from './SessionItem';
import ImportModal from './ImportModal';

export default function SessionSection() {
  const { state, createSession, selectSession, deleteSession } = useAppContext();
  const [showImport, setShowImport] = useState(false);

  // 只显示当前角色的会话
  const filtered = state.currentCharacterId
    ? state.sessions.filter((s) => s.characterId === state.currentCharacterId)
    : state.sessions;

  const handleDelete = async (id: string) => {
    if (!confirm('删除这个会话？')) return;
    try {
      await deleteSession(id);
    } catch (err) {
      alert('删除失败: ' + (err as Error).message);
    }
  };

  return (
    <div id="sessions-section">
      <div className="sessions-actions">
        <button
          id="new-session-btn"
          disabled={!state.currentCharacterId}
          onClick={createSession}
        >
          ＋ 新建会话
        </button>
        <button
          id="import-btn"
          disabled={!state.currentSessionId}
          onClick={() => setShowImport(true)}
          title="导入聊天记录（微信/QQ/纯文本）"
        >
          📥 导入
        </button>
      </div>
      <div id="session-list">
        {filtered.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === state.currentSessionId}
            onSelect={selectSession}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
