import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CharactersModule } from './characters/characters.module';
import { SessionsModule } from './sessions/sessions.module';
import { ChatModule } from './chat/chat.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { MemoriesModule } from './memories/memories.module';
import { RecordsImportModule } from './records-import/records-import.module';
import { InitPgvectorSchema1710000000000 } from './migrations/1710000000000-init-pgvector-schema';

// 前端构建产物路径
const WEB_DIST = join(__dirname, '..', 'web', 'dist');

@Module({
  imports: [
    // 静态文件服务（前端页面）
    // 开发阶段：Vite dev server (5173) 代理 API 到后端，此模块不生效
    // 生产部署：先执行 npm run build:web，再启动后端，自动服务 web/dist/
    ServeStaticModule.forRoot({
      rootPath: existsSync(WEB_DIST) ? WEB_DIST : join(__dirname, '..', 'web', 'dist'),
      serveRoot: '/',       // 从根路径提供静态文件
      // exclude 不设置：NestJS 路由优先于静态文件
      serveStaticOptions: {
        index: ['index.html'], // SPA fallback
      },
    }),

    // 加载 .env 配置文件（全局可用）
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // TypeORM 数据库连接
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT ?? '54321', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'companion',
      autoLoadEntities: true, // 自动加载各模块注册的 Entity
      synchronize: false, // pgvector 表必须走 migration，避免 TypeORM 删除 vector 列
      migrations: [InitPgvectorSchema1710000000000],
      migrationsRun: true, // 启动时自动补齐 pgvector 扩展和表结构
      logging: process.env.DB_LOGGING === 'true',
    }),

    // 业务模块
    CharactersModule,
    SessionsModule,
    ChatModule,
    EmbeddingModule,
    MemoriesModule,
    RecordsImportModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
