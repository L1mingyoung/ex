import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import InputArea from './InputArea';
import './ChatArea.css';

export default function ChatArea() {
  return (
    <div id="chat-area">
      <ChatHeader />
      <MessageList />
      <InputArea />
    </div>
  );
}
