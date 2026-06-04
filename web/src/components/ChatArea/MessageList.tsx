import { useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import MessageBubble from './MessageBubble';

export default function MessageList() {
  const { state } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);

  // 新消息时自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [state.messages]);

  return (
    <div id="messages" ref={containerRef}>
      {state.messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
    </div>
  );
}
