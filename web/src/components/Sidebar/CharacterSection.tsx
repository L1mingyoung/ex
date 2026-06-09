import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../Toast';
import type { CharacterData } from '@shared/types';
import CharacterItem from './CharacterItem';
import NewCharacterForm from './NewCharacterForm';
import EditCharacterModal from './EditCharacterModal';

export default function CharacterSection() {
  const { state, selectCharacter, loadSessions } = useAppContext();
  const { toast } = useToast();
  const [editing, setEditing] = useState<CharacterData | null>(null);

  const handleSelect = (id: string) => {
    selectCharacter(id);
  };

  const handleEdit = (character: CharacterData) => {
    setEditing(character);
  };

  const handleCloseModal = () => {
    setEditing(null);
    loadSessions();
  };

  return (
    <div>
      <h3>角色</h3>
      <div id="character-list">
        {state.characters.length === 0 && (
          <p className="empty-hint">还没有角色，创建一个开始吧</p>
        )}
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
