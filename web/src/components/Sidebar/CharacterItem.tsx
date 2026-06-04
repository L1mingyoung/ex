import type { CharacterData } from '@shared/types';

interface CharacterItemProps {
  character: CharacterData;
  isActive: boolean;
  onSelect: (id: string) => void;
  onEdit: (character: CharacterData) => void;
}

export default function CharacterItem({
  character,
  isActive,
  onSelect,
  onEdit,
}: CharacterItemProps) {
  return (
    <div className={`character-item ${isActive ? 'active' : ''}`}>
      <span className="char-avatar">{character.name[0]}</span>
      <div className="char-info" onClick={() => onSelect(character.id)}>
        <span className="char-name">{character.name}</span>
        <span className="char-prompt-preview">
          {character.basePrompt.slice(0, 30)}...
        </span>
      </div>
      <button
        className="char-edit-btn"
        title="编辑角色"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(character);
        }}
      >
        ✎
      </button>
    </div>
  );
}
