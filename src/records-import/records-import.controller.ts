import { Body, Controller, Post, Param } from '@nestjs/common';
import { RecordsImportService, type ImportChatRecordsDto, type ImportChatRecordsResult } from './records-import.service';

@Controller('api/import')
export class RecordsImportController {
  constructor(private readonly recordsImportService: RecordsImportService) {}

  @Post('chat-records')
  importChatRecords(@Body() dto: ImportChatRecordsDto): Promise<ImportChatRecordsResult> {
    return this.recordsImportService.importChatRecords(dto);
  }

  /**
   * 从已导入的聊天记录中生成角色人设
   *
   * mode:
   *   'replace' — 用聊天记录完全重写 base_prompt（纯 AI 生成）
   *   'merge'   — 保留手动设定，追加从记录中分析出的说话风格
   */
  @Post('enrich-character/:sessionId')
  enrichCharacter(
    @Param('sessionId') sessionId: string,
    @Body() body?: { mode?: 'replace' | 'merge' },
  ) {
    return this.recordsImportService.enrichCharacterProfile(sessionId, body?.mode ?? 'replace');
  }
}
