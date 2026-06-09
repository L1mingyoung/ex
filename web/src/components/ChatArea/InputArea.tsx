import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';

export default function InputArea() {
  const { state, sendMessage, stopStreaming } = useAppContext();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !state.currentSessionId || state.isStreaming;

  useEffect(() => {
    if (state.currentSessionId && !state.isStreaming) {
      textareaRef.current?.focus();
    }
  }, [state.currentSessionId, state.isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);

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
        placeholder={state.isStreaming ? '等待回复中...' : '输入消息...'}
        disabled={disabled}
        rows={1}
      />
      {state.isStreaming ? (
        <button
          id="stop-btn"
          onClick={stopStreaming}
        >
          停止
        </button>
      ) : (
        <button
          id="send-btn"
          onClick={handleSend}
          disabled={!text.trim() || !state.currentSessionId}
        >
          发送
        </button>
      )}
    </div>
  );
}
