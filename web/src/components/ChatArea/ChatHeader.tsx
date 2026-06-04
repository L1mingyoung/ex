import { useAppContext } from '../../context/AppContext';

export default function ChatHeader() {
  const { state } = useAppContext();

  const title = state.currentSessionId
    ? `对话 #${state.currentSessionId.slice(0, 8)}`
    : '选择一个会话开始聊天';

  return (
    <div id="chat-header">
      <h2>{title}</h2>
    </div>
  );
}
