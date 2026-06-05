import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../characters/entities/character.entity';
import { RecordsImportController } from './records-import.controller';
import { RecordsImportService } from './records-import.service';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagesModule } from '../messages/messages.module';
import { MemoriesModule } from '../memories/memories.module';
import { LlmModule } from '../llm/llm.module';
import { EmotionModule } from '../emotion/emotion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Character]),
    SessionsModule,
    MessagesModule,
    MemoriesModule,
    LlmModule,
    EmotionModule,
  ],
  controllers: [RecordsImportController],
  providers: [RecordsImportService],
})
export class RecordsImportModule {}
