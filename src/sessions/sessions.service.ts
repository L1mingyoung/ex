import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from './entities/session.entity';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
  ) {}

  create(characterId: string, title?: string) {
    const session = this.sessionRepo.create({ characterId, title });
    return this.sessionRepo.save(session);
  }

  findAll() {
    return this.sessionRepo.find({ order: { updatedAt: 'DESC' } });
  }

  async findOne(id: string) {
    const session = await this.sessionRepo.findOne({ where: { id } });
    if (!session) {
      throw new NotFoundException(`会话 "${id}" 不存在`);
    }
    return session;
  }

  async updateSummary(id: string, summary: string) {
    await this.sessionRepo.update(id, { summary });
    return this.findOne(id);
  }

  async incrementMessageCount(id: string) {
    await this.sessionRepo.increment({ id }, 'messageCount', 1);
    // 同时更新 updatedAt
    await this.sessionRepo.update(id, { updatedAt: new Date() });
    return this.findOne(id);
  }

  async delete(id: string) {
    const session = await this.findOne(id);
    return this.sessionRepo.remove(session);
  }
}
