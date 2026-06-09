import { useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import MessageBubble from './MessageBubble';

export default function MessageList() {
  const { state } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 80;
  }, []);

  useEffect(() => {
    if (containerRef.current && !userScrolledUp.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [state.messages]);

  if (!state.currentSessionId) {
    return (
      <div id="messages" className="messages-empty">
        <div className="welcome-state">
          <div className="welcome-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h3 className="welcome-title">开始一段对话</h3>
          <p className="welcome-desc">
            从左侧选择一个角色和会话，<br />
            或创建新的角色开始聊天
          </p>
        </div>
      </div>
    );
  }

  if (state.messages.length === 0) {
    return (
      <div id="messages" className="messages-empty">
        <div className="welcome-state">
          <div className="welcome-icon welcome-icon-small">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
          <p className="welcome-desc">发送第一条消息开始聊天</p>
        </div>
      </div>
    );
  }

  return (
    <div id="messages" ref={containerRef} onScroll={handleScroll}>
      {state.messages.map((msg, i) => (
        <MessageBubble
          key={`${msg.role}-${i}`}
          message={msg}
          isLast={i === state.messages.length - 1}
        />
      ))}
    </div>
  );
}
