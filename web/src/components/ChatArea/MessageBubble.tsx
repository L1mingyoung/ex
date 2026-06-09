import type { ChatMessageItem } from '@shared/types';

interface MessageBubbleProps {
  message: ChatMessageItem;
  isLast: boolean;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export default function MessageBubble({ message, isLast }: MessageBubbleProps) {
  const classes = [
    'message',
    message.role,
    message.isStreaming ? 'streaming' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isUser = message.role === 'user';
  const time = formatTime(message.timestamp);

  return (
    <div className={classes}>
      {!isUser && (
        <div className="message-avatar">
          <span className="avatar-ai">AI</span>
        </div>
      )}
      <div className="message-body">
        <div className="message-content">{message.content || '\u00A0'}</div>
        <div className="message-meta">
          {time && <span className="message-time">{time}</span>}
          {message.isStreaming && isLast && (
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
