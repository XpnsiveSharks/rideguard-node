import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  await app.listen(Number(process.env.PORT) || 5565);
  const nodeEnv = process.env.NODE_ENV || 'local';

  app.enableCors({
    origin: nodeEnv === 'production' ? ['https://replace-frontend.com'] : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-country-origin'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
}
bootstrap();
