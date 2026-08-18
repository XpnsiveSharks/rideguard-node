import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { networkInterfaces } from 'os';
import { AppModule } from './app.module';

function getLocalIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((networkInterface) => networkInterface ?? [])
    .filter((address) => address.family === 'IPv4' && address.internal === false)
    .map((address) => address.address);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const port = Number(process.env.PORT) || 5565;
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
      logger.log(`Server is running on http://${localIp}:${port}/v1`);
    }

    return;
  }

  logger.log(`Server is running on http://localhost:${port}/v1`);
}
bootstrap();
