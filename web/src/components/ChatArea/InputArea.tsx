import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';

export default function InputArea() {
  const { state, sendMessage } = useAppContext();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !state.currentSessionId || state.isStreaming;

  // 选中会话时自动聚焦输入框
  useEffect(() => {
    if (state.currentSessionId) {
      textareaRef.current?.focus();
    }
  }, [state.currentSessionId]);

  const handleSend = () => {
    const content = text.trim();
    if (!content || disabled) return;
    setText('');
    sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div id="input-area">
      <textarea
        id="message-input"
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        rows={2}
      />
      <button id="send-btn" onClick={handleSend} disabled={disabled}>
        发送
      </button>
    </div>
  );
}
