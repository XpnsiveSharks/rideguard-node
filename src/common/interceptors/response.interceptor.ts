import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

const DEFAULT_SUCCESS_MESSAGE = 'Request completed successfully';

export interface StandardResponse<T> {
  success: true;
  message: string;
  data: T;
}

// Wraps every successful response in a consistent envelope.
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<StandardResponse<T>> {
    const message = this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: message ?? DEFAULT_SUCCESS_MESSAGE,
        data: (data ?? {}) as T,
      })),
    );
  }
}
