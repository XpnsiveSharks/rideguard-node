import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from '@jest/globals';
import { of } from 'rxjs';
import { ResponseMessage } from '../decorators/response-message.decorator';
import { ResponseInterceptor } from './response.interceptor';

function createExecutionContext(handler: () => void = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function createCallHandler(data: unknown): CallHandler {
  return { handle: () => of(data) };
}

describe('ResponseInterceptor', () => {
  it('wraps the handler result with the default success message and timestamps', (done) => {
    const interceptor = new ResponseInterceptor(new Reflector());
    const context = createExecutionContext();

    interceptor.intercept(context, createCallHandler({ id: 1 })).subscribe((result) => {
      expect(result).toEqual({
        success: true,
        message: 'Request completed successfully',
        data: { id: 1 },
        timestamp: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
      done();
    });
  });

  it('falls back to an empty object when the handler returns nothing', (done) => {
    const interceptor = new ResponseInterceptor(new Reflector());
    const context = createExecutionContext();

    interceptor.intercept(context, createCallHandler(undefined)).subscribe((result) => {
      expect(result.data).toEqual({});
      done();
    });
  });

  it('uses the message set by @ResponseMessage on the handler', (done) => {
    class TestController {
      @ResponseMessage('Custom success message')
      handler() {}
    }

    const controller = new TestController();
    const reflector = new Reflector();
    const interceptor = new ResponseInterceptor(reflector);
    // Passed by reference (not called) so Reflector can read the metadata attached to the function itself.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const context = createExecutionContext(controller.handler);

    interceptor.intercept(context, createCallHandler({})).subscribe((result) => {
      expect(result.message).toBe('Custom success message');
      done();
    });
  });
});

// NOTES: to run this test, use the following command in your terminal:
// yarn test response.interceptor
