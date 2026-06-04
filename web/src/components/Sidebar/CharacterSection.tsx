import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import type { CharacterData } from '@shared/types';
import CharacterItem from './CharacterItem';
import NewCharacterForm from './NewCharacterForm';
import EditCharacterModal from './EditCharacterModal';

export default function CharacterSection() {
  const { state, selectCharacter, loadSessions } = useAppContext();
  const [editing, setEditing] = useState<CharacterData | null>(null);

  const handleSelect = (id: string) => {
    selectCharacter(id);
  };

  const handleEdit = (character: CharacterData) => {
    setEditing(character);
  };

  const handleCloseModal = () => {
    setEditing(null);
    // 刷新列表以获取最新数据
    loadSessions();
  };

  return (
    <div>
      <h3>角色</h3>
      <div id="character-list">
        {state.characters.map((c) => (
          <CharacterItem
            key={c.id}
            character={c}
            isActive={c.id === state.currentCharacterId}
            onSelect={handleSelect}
            onEdit={handleEdit}
          />
        ))}
      </div>
      <NewCharacterForm />
      {editing && (
        <EditCharacterModal character={editing} onClose={handleCloseModal} />
      )}
    </div>
  );
}
