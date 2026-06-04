import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CharactersModule } from './characters/characters.module';
import { SessionsModule } from './sessions/sessions.module';
import { ChatModule } from './chat/chat.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { MemoriesModule } from './memories/memories.module';

@Module({
  imports: [
    // 静态文件服务（前端页面）
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
      exclude: ['/api/(.*)'], // API 路由不走静态文件
    }),

    // 加载 .env 配置文件（全局可用）
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // TypeORM 数据库连接
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT ?? '54321', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'companion',
      autoLoadEntities: true, // 自动加载各模块注册的 Entity
      synchronize: true, // 【开发阶段】自动同步表结构。上线前必须改为 false
      logging: true, // 打印 SQL 语句，方便调试学习
    }),

    // 业务模块
    CharactersModule,
    SessionsModule,
    ChatModule,
    EmbeddingModule,
    MemoriesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
