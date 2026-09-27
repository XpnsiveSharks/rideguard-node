import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { EnvironmentVariables, NodeEnvironment } from '@/config/env.validation';

const PRETTY_LOG_ENVIRONMENTS: NodeEnvironment[] = ['local', 'development'];

export const createLoggerOptions = (
  configService: ConfigService<EnvironmentVariables, true>,
): Params => {
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const usePrettyLogs = PRETTY_LOG_ENVIRONMENTS.includes(nodeEnv);

  return {
    pinoHttp: {
      // Keep secrets out of the logs. Without this, logging a request would
      // print the Authorization/Cookie headers, which contain login tokens.
      // `redact` swaps those values for "[REDACTED]". Node stores header names
      // in lower case, so we list them in lower case here.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
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
