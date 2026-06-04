import type { SessionData } from '@shared/types';

interface SessionItemProps {
  session: SessionData;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionItemProps) {
  return (
    <div
      className={`session-item ${isActive ? 'active' : ''}`}
      onClick={() => onSelect(session.id)}
    >
      <span>💬</span>
      <span className="session-title">{session.title || '新对话'}</span>
      <span className="session-count">{session.messageCount}</span>
      <button
        className="session-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
      >
        ×
      </button>
    </div>
  );
}
