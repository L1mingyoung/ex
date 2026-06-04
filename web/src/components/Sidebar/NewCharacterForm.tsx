import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';

export default function NewCharacterForm() {
  const { createCharacter } = useAppContext();
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
    } catch (err) {
      alert('创建角色失败: ' + (err as Error).message);
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
