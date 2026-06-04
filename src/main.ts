import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS：允许任何来源调用 API（开发阶段）
  // 生产环境应限制为具体域名
  app.enableCors({
    origin: true,
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 AI Companion running on http://localhost:${port}`);
  console.log(`   Web 聊天: http://localhost:${port}`);
  console.log(`   API:      http://localhost:${port}/api`);
}
bootstrap();
