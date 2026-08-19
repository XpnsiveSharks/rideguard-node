import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { HttpExceptionFilter } from './http-exception.filter';

function createHost() {
  const json = jest.fn();
  const status = jest.fn((statusCode: number) => {
    void statusCode;
    return { json };
  });
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  it('maps a simple HttpException to the standard error body', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('Resource not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Resource not found',
      statusCode: 404,
      timestamp: expect.any(String),
    });
  });

  it('joins array-shaped validation messages into one string', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(
      new BadRequestException(['name should not be empty', 'email must be an email']),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'name should not be empty, email must be an email',
      statusCode: 400,
      timestamp: expect.any(String),
    });
  });

  it('preserves the exception status code', () => {
    const filter = new HttpExceptionFilter();
    const { host, status } = createHost();

    filter.catch(new BadRequestException('Invalid payload'), host);

    expect(status).toHaveBeenCalledWith(400);
  });
});

// To run this test, use the following command in your terminal:
// yarn run test http-exception.filter
