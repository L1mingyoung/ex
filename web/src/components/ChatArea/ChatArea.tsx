import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import InputArea from './InputArea';
import './ChatArea.css';

interface ChatAreaProps {
  onMenuClick: () => void;
}

export default function ChatArea({ onMenuClick }: ChatAreaProps) {
  return (
    <div id="chat-area">
      <ChatHeader onMenuClick={onMenuClick} />
      <MessageList />
      <InputArea />
    </div>
  );
}
