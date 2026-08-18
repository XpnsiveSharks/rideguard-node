import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'responseMessage';

// Lets a handler override the interceptor's default success message,
// e.g. @ResponseMessage('User profile retrieved successfully').
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);
