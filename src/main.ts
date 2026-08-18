import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { networkInterfaces } from 'os';
import { AppModule } from './app.module';
import type { EnvironmentVariables } from './config/env.validation';

function getLocalIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((networkInterface) => networkInterface ?? [])
    .filter((address) => address.family === 'IPv4' && address.internal === false)
    .map((address) => address.address);
}

async function bootstrap() {
  // Env validation runs while the modules initialise, so a bad .env fails here.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const port = configService.get('PORT', { infer: true });
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const apiVersion = configService.get('API_VERSION', { infer: true });
  const corsOrigins = configService.get('CORS_ORIGINS', { infer: true });

  app.enableCors({
    origin: corsOrigins === '*' ? '*' : corsOrigins.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-country-origin'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: apiVersion,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  await app.listen(port, '0.0.0.0');

  logger.log(`Started in ${nodeEnv} mode`);

  if (nodeEnv === 'local') {
    const localIpv4Addresses = getLocalIpv4Addresses();
    if (localIpv4Addresses.length === 0) {
      logger.warn('No local network IPv4 address detected');
    }

    for (const localIp of localIpv4Addresses) {
      logger.log(`Server is running on http://${localIp}:${port}/v${apiVersion}`);
    }

    return;
  }

  logger.log(`Server is running on http://localhost:${port}/v${apiVersion}`);
}
bootstrap();
