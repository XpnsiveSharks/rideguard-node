import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

interface ErrorResponseBody {
  success: false;
  message: string;
  statusCode: number;
  timestamp: string;
  [key: string]: unknown;
}

/* Catches NestJS HTTP exceptions (NotFoundException, UnauthorizedException,
 * BadRequestException, etc.) and shapes them into a consistent error body.
 * Non-HTTP errors are left to Nest's default handler — out of scope here.
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = exception.getStatus();
    const now = new Date();

    const body: ErrorResponseBody = {
      success: false,
      message: extractMessage(exception),
      statusCode,
      timestamp: now.toISOString(),
      ...extractDetails(exception),
    };

    response.status(statusCode).json(body);
  }
}

/* HttpException's response payload is either a plain string, or an object
 * (Nest's built-in exceptions, and ValidationPipe, shape it as
 * `{ message, error, statusCode }`, where `message` can itself be a string
 * array). Normalize all of that down to one string.
 */
function extractMessage(exception: HttpException): string {
  const payload = exception.getResponse();

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload;

    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }

  return exception.message;
}

function extractDetails(exception: HttpException): Record<string, unknown> {
  const payload = exception.getResponse();

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !['success', 'message', 'error', 'statusCode', 'timestamp'].includes(key),
    ),
  );
}
