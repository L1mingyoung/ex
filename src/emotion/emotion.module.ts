import { Module } from '@nestjs/common';
import { JiwenEmotionService } from './jiwen-emotion.service';

@Module({
  providers: [JiwenEmotionService],
  exports: [JiwenEmotionService],
})
export class EmotionModule {}
