import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';

const PRETTY_LOG_ENVIRONMENTS = ['local', 'development'];

export const createLoggerOptions = (configService: ConfigService): Params => {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'local';
  const usePrettyLogs = PRETTY_LOG_ENVIRONMENTS.includes(nodeEnv);

  return {
    pinoHttp: {
      transport: usePrettyLogs
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
};
