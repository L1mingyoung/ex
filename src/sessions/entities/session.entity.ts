import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface ImportProfile {
  userPersona?: {
    stableFacts?: string[];
    preferences?: string[];
    communicationStyle?: string[];
    emotionalPatterns?: string[];
    boundaries?: string[];
  };
  relationshipProfile?: {
    relationshipTone?: string;
    closenessLevel?: 'low' | 'medium' | 'high' | string;
    trustSignals?: string[];
    recurringTopics?: string[];
    supportNeeds?: string[];
    assistantRole?: string;
  };
  evidence?: {
    source?: string;
    messageCount?: number;
    generatedAt?: string;
  };
}

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'character_id' })
  characterId: string;

  @Column({ nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ name: 'message_count', default: 0 })
  messageCount: number;

  @Column({ name: 'last_summary_at', type: 'timestamptz', nullable: true })
  lastSummaryAt: Date | null;

  @Column({ name: 'import_profile', type: 'jsonb', nullable: true })
  importProfile: ImportProfile | null;

  @Column({ name: 'profile_updated_at', type: 'timestamptz', nullable: true })
  profileUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
