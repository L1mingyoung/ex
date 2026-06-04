import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载 .env 文件（CLI 运行 migration 时需要）
dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT ?? '54321', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'companion',
  entities: [path.join(__dirname, '..', '**', '*.entity{.ts,.js}')],
  synchronize: false, // 生产必须 false，开发阶段用 migration 管理
  migrations: [path.join(__dirname, '..', '..', 'migrations', '*{.ts,.js}')],
  migrationsRun: true, // 启动时自动跑 migration
  logging: true, // 开发时打印 SQL，方便学习
});
