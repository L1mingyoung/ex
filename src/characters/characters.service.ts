import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from './entities/character.entity';

@Injectable()
export class CharactersService {
  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
  ) {}

  create(data: { id: string; name: string; basePrompt: string; model?: string }) {
    const character = this.characterRepo.create(data);
    return this.characterRepo.save(character);
  }

  findAll() {
    return this.characterRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const character = await this.characterRepo.findOne({ where: { id } });
    if (!character) {
      throw new NotFoundException(`角色 "${id}" 不存在`);
    }
    return character;
  }

  async update(id: string, data: Partial<Pick<Character, 'name' | 'basePrompt' | 'model' | 'speechPatterns'>>) {
    const character = await this.findOne(id);
    Object.assign(character, data);
    return this.characterRepo.save(character);
  }

  async delete(id: string) {
    const character = await this.findOne(id);
    return this.characterRepo.remove(character);
  }
}
