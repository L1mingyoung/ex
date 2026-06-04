import { Controller, Get, Post, Put, Body, Param, Delete } from '@nestjs/common';
import { CharactersService } from './characters.service';

interface CreateCharacterDto {
  id: string;
  name: string;
  base_prompt: string;
  model?: string;
}

interface UpdateCharacterDto {
  name?: string;
  base_prompt?: string;
  model?: string;
}

@Controller('api/characters')
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Post()
  create(@Body() body: CreateCharacterDto) {
    return this.charactersService.create({
      id: body.id,
      name: body.name,
      basePrompt: body.base_prompt,
      model: body.model,
    });
  }

  @Get()
  findAll() {
    return this.charactersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.charactersService.findOne(id);
  }

  /** 修改角色（名称、人格、模型） */
  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateCharacterDto) {
    return this.charactersService.update(id, {
      ...(body.name && { name: body.name }),
      ...(body.base_prompt && { basePrompt: body.base_prompt }),
      ...(body.model && { model: body.model }),
    });
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.charactersService.delete(id);
  }
}
