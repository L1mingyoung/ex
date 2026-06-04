import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from './entities/character.entity';
import { CharactersService } from './characters.service';
import { CharactersController } from './characters.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Character])], // 注册 Entity，生成 Repository
  controllers: [CharactersController],
  providers: [CharactersService],
  exports: [CharactersService, TypeOrmModule], // 导出给其他模块使用（Sessions 需要查角色）
})
export class CharactersModule {}
