import { useAppContext } from '../../context/AppContext';

const STATUS_CONFIG: Record<string, { color: string }> = {
  online: { color: '#4ade80' },
  streaming: { color: '#facc15' },
  error: { color: '#ef4444' },
};

export default function StatusBar() {
  const { state } = useAppContext();
  const cfg = STATUS_CONFIG[state.statusType] || STATUS_CONFIG.online;
  const text =
    state.statusType === 'online'
      ? '在线'
      : state.statusType === 'streaming'
        ? '回复中...'
        : state.statusMessage || '错误';

  return (
    <div id="status-bar">
      <span id="status-dot" style={{ background: cfg.color }} />
      <span>{text}</span>
    </div>
  );
}
