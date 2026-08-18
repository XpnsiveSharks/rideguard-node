import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { EnvironmentVariables, NodeEnvironment } from '../../config/env.validation';

const PRETTY_LOG_ENVIRONMENTS: NodeEnvironment[] = ['local', 'development'];

export const createLoggerOptions = (
  configService: ConfigService<EnvironmentVariables, true>,
): Params => {
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
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
