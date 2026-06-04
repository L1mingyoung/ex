import type { ChatMessageItem } from '@shared/types';

interface MessageBubbleProps {
  message: ChatMessageItem;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const classes = [
    'message',
    message.role,
    message.isStreaming ? 'streaming' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{message.content}</div>;
}
