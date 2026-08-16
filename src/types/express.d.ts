import { DecodedIdToken } from 'firebase-admin/auth';

declare global {
  namespace Express {
    // basically we are merging Express.Request interface with our own custom property user of type DecodedIdToken. This is useful when we want to add additional properties to the Request object in our Express application, such as the authenticated user's information.
    interface Request {
      user?: DecodedIdToken;
    }
  }
}
