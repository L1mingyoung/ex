import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../Toast';

export default function NewCharacterForm() {
  const { createCharacter } = useAppContext();
  const { toast } = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedId || !trimmedName || !trimmedPrompt) return;

    try {
      await createCharacter(trimmedId, trimmedName, trimmedPrompt);
      setId('');
      setName('');
      setPrompt('');
      toast('角色创建成功', 'success');
    } catch (err) {
      toast('创建角色失败: ' + (err as Error).message, 'error');
    }
  };

  return (
    <form id="new-char-form" onSubmit={handleSubmit}>
      <input
        placeholder="角色 ID（如 xiaoqi）"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <input
        placeholder="角色名称（如 小七）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        placeholder="人格提示词..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button type="submit">创建角色</button>
    </form>
  );
}
