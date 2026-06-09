import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../Toast';
import type { CharacterData } from '@shared/types';

interface EditCharacterModalProps {
  character: CharacterData;
  onClose: () => void;
}

export default function EditCharacterModal({
  character,
  onClose,
}: EditCharacterModalProps) {
  const { updateCharacter, deleteCharacter } = useAppContext();
  const { toast } = useToast();
  const [name, setName] = useState(character.name);
  const [basePrompt, setBasePrompt] = useState(character.basePrompt);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCharacter(character.id, name.trim(), basePrompt.trim());
      toast('角色已保存', 'success');
      onClose();
    } catch (err) {
      toast('保存失败: ' + (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除角色「${character.name}」及其所有会话？`)) return;
    try {
      await deleteCharacter(character.id);
      toast('角色已删除', 'success');
      onClose();
    } catch (err) {
      toast('删除失败: ' + (err as Error).message, 'error');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>编辑角色: {character.name}</h3>

        <label>名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <label>人格设定</label>
        <textarea
          value={basePrompt}
          onChange={(e) => setBasePrompt(e.target.value)}
        />

        <div className="modal-actions">
          <button className="btn-danger" onClick={handleDelete}>
            删除
          </button>
          <button className="btn-cancel" onClick={onClose}>
            取消
          </button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
