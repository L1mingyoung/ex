import { Body, Controller, Post } from '@nestjs/common';
import { RecordsImportService, type ImportChatRecordsDto, type ImportChatRecordsResult } from './records-import.service';

@Controller('api/import')
export class RecordsImportController {
  constructor(private readonly recordsImportService: RecordsImportService) {}

  @Post('chat-records')
  importChatRecords(@Body() dto: ImportChatRecordsDto): Promise<ImportChatRecordsResult> {
    return this.recordsImportService.importChatRecords(dto);
  }
}
