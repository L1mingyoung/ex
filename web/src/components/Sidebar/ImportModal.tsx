import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import * as API from '../../api/index';
import type { ImportChatRecordsResult } from '@shared/types';

interface ImportModalProps {
  onClose: () => void;
}

const EXAMPLE_TEXT = `2026-06-04 21:18:03 我
今天加班好累

2026-06-04 21:19:10 小雅
辛苦啦，我陪你缓一下

小雅：要不要喝点水放松一下？
我：好，你陪我聊会儿天吧`;

export default function ImportModal({ onClose }: ImportModalProps) {
  const { state, loadSessions, loadMessages } = useAppContext();

  const [text, setText] = useState('');
  const [userAliases, setUserAliases] = useState('');
  const [assistantAliases, setAssistantAliases] = useState('');
  const [triggerMemory, setTriggerMemory] = useState(true);
  const [generateSummary, setGenerateSummary] = useState(true);
  const [extractProfile, setExtractProfile] = useState(true);

  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportChatRecordsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canImport =
    state.currentSessionId && text.trim().length > 0 && !importing;

  const handleImport = async () => {
    if (!canImport) return;

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await API.importChatRecords({
        sessionId: state.currentSessionId!,
        text: text.trim(),
        userAliases: userAliases
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        assistantAliases: assistantAliases
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        triggerMemoryExtraction: triggerMemory,
        generateSummary,
        extractProfile,
        mode,
      });
      setResult(res);
      await loadSessions();
      // 刷新当前会话的消息列表
      if (state.currentSessionId) {
        await loadMessages(state.currentSessionId);
      }
    } catch (err) {
      setError((err as Error).message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleFillExample = () => {
    setText(EXAMPLE_TEXT);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal import-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>📥 导入聊天记录</h3>

        {!state.currentSessionId && (
          <p className="import-hint-warn">⚠️ 请先在侧边栏选择一个会话</p>
        )}

        {/* 主输入区 */}
        <label>
          聊天记录文本
          <button
            type="button"
            className="fill-example-btn"
            onClick={handleFillExample}
          >
            填入示例
          </button>
        </label>
        <textarea
          className="import-textarea"
          placeholder="粘贴微信/QQ/纯文本聊天记录…
支持多种格式：
  2026-06-04 21:18:03 用户名
  消息内容
  用户名：消息内容"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={importing}
        />

        {/* 别名设置 */}
        <div className="import-aliases">
          <div className="import-alias-group">
            <label>用户别名</label>
            <input
              placeholder="我, 用户, 自己的微信名"
              value={userAliases}
              onChange={(e) => setUserAliases(e.target.value)}
              disabled={importing}
            />
            <span className="alias-hint">
              默认已包含: 我、用户、user、me
            </span>
          </div>
          <div className="import-alias-group">
            <label>AI 别名</label>
            <input
              placeholder="小雅, AI, bot"
              value={assistantAliases}
              onChange={(e) => setAssistantAliases(e.target.value)}
              disabled={importing}
            />
            <span className="alias-hint">
              默认已包含: ai、assistant、bot、小雅
            </span>
          </div>
        </div>

        {/* 角色设定模式 */}
        <div className="import-options">
          <label className="import-radio-label">角色设定处理方式：</label>
          <label className="import-radio">
            <input
              type="radio"
              name="mode"
              value="merge"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
              disabled={importing}
            />
            🔗 合并模式 — 保留手动设定，从记录追加说话风格
          </label>
          <label className="import-radio">
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              disabled={importing}
            />
            🔄 替换模式 — 用聊天记录完全重写角色人设
          </label>
        </div>

        {/* 选项 */}
        <div className="import-options">
          <label className="import-checkbox">
            <input
              type="checkbox"
              checked={triggerMemory}
              onChange={(e) => setTriggerMemory(e.target.checked)}
              disabled={importing}
            />
            导入后自动提取长期记忆
          </label>
          <label className="import-checkbox">
            <input
              type="checkbox"
              checked={generateSummary}
              onChange={(e) => setGenerateSummary(e.target.checked)}
              disabled={importing}
            />
            导入后生成会话摘要
          </label>
          <label className="import-checkbox">
            <input
              type="checkbox"
              checked={extractProfile}
              onChange={(e) => setExtractProfile(e.target.checked)}
              disabled={importing}
            />
            导入后提取人格/关系画像
          </label>
        </div>

        {/* 错误提示 */}
        {error && <p className="import-error">{error}</p>}

        {/* 导入结果 */}
        {result && (
          <div className="import-result">
            <h4>✅ 导入完成</h4>
            <div className="import-stats">
              <span>解析: <strong>{result.parsed}</strong> 条</span>
              <span>写入: <strong>{result.inserted}</strong> 条</span>
            </div>
            <div className="import-flags">
              {result.memoryExtractionQueued && (
                <span className="flag">🧠 记忆提取已排队</span>
              )}
              {result.summaryQueued && (
                <span className="flag">📝 摘要生成已排队</span>
              )}
              {result.profileExtractionQueued && (
                <span className="flag">👤 画像提取已排队</span>
              )}
            </div>
            {result.preview.length > 0 && (
              <details className="import-preview">
                <summary>预览前 {result.preview.length} 条</summary>
                <ul>
                  {result.preview.map((r, i) => (
                    <li key={i} className={`preview-${r.role}`}>
                      <span className="preview-speaker">{r.speaker}</span>
                      <span className="preview-content">{r.content}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose} disabled={importing}>
            关闭
          </button>
          <button
            className="btn-save"
            onClick={handleImport}
            disabled={!canImport}
          >
            {importing ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  );
}
