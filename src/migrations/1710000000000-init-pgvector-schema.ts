import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitPgvectorSchema1710000000000 implements MigrationInterface {
  name = 'InitPgvectorSchema1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE messages_role_enum AS ENUM ('user', 'assistant');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE memory_chunks_memory_type_enum AS ENUM ('fact', 'preference', 'emotion');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS characters (
        id text PRIMARY KEY,
        name character varying NOT NULL,
        base_prompt text NOT NULL,
        model character varying NOT NULL DEFAULT 'deepseek-chat',
        speech_patterns jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id character varying NOT NULL,
        title character varying,
        summary text,
        message_count integer NOT NULL DEFAULT 0,
        last_summary_at timestamptz,
        import_profile jsonb,
        profile_updated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_summary_at timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS import_profile jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id bigserial PRIMARY KEY,
        session_id character varying NOT NULL,
        role messages_role_enum NOT NULL,
        content text NOT NULL,
        emotion_snapshot jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id bigserial PRIMARY KEY,
        session_id uuid NOT NULL,
        source_msg_id bigint,
        content text NOT NULL,
        embedding vector(768) NOT NULL,
        memory_type memory_chunks_memory_type_enum NOT NULL,
        importance_score double precision NOT NULL DEFAULT 0.5,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_accessed timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_session_created_at ON messages (session_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memory_session_created_at ON memory_chunks (session_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory_chunks USING hnsw (embedding vector_cosine_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memory_embedding`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memory_session_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_messages_session_created_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS memory_chunks`);
    await queryRunner.query(`DROP TABLE IF EXISTS messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS characters`);
    await queryRunner.query(`DROP TYPE IF EXISTS memory_chunks_memory_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS messages_role_enum`);
  }
}
