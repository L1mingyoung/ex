import { Module } from '@nestjs/common';
import { JiwenEmotionService } from './jiwen-emotion.service';
import { MoodService } from './mood.service';

@Module({
  providers: [JiwenEmotionService, MoodService],
  exports: [JiwenEmotionService, MoodService],
})
export class EmotionModule {}
