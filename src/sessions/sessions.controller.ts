import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SessionsService } from './sessions.service';

@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(@Body() body: { characterId: string; title?: string }) {
    console.log('[Sessions] POST body:', JSON.stringify(body));
    console.log(
      '[Sessions] characterId:',
      body.characterId,
      'title:',
      body.title,
    );
    return this.sessionsService.create(body.characterId, body.title);
  }

  @Get()
  findAll() {
    return this.sessionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.sessionsService.delete(id);
  }
}
