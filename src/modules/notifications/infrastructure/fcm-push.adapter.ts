import { Inject, Injectable } from '@nestjs/common';
import type { Messaging, Notification, SendResponse } from 'firebase-admin/messaging';
import { FIREBASE_MESSAGING } from '@/infra/firebase/firebase.constants';
import { PushNotification } from '../domain/push-notification.value-object';
import {
  FCM_INVALID_TOKEN_ERROR_CODES,
  FCM_MULTICAST_TOKEN_LIMIT,
} from '../notifications.constants';
import type { FcmSendOutcome } from '../notifications.types';

// The content pieces shared by every token in a send, before the tokens are
// attached per batch.
type FcmMessageContent = {
  notification: Notification;
  data: Record<string, string>;
};

// Delivers push notifications through Firebase Cloud Messaging. This adapter
// only talks to FCM: it does not look up users, choose recipients, or touch
// Firestore. Those stay in the service and repository.
@Injectable()
export class FcmPushAdapter {
  constructor(
    @Inject(FIREBASE_MESSAGING)
    private readonly messaging: Messaging,
  ) {}

  // Sends one notification to the given FCM tokens and reports the outcome for
  // each token so the caller can count failures and prune invalid tokens.
  async send(tokens: readonly string[], notification: PushNotification): Promise<FcmSendOutcome[]> {
    // Sending to the same token twice would deliver a duplicate notification.
    const uniqueTokens = [...new Set(tokens)];

    // Nothing to send: skip the network call entirely.
    if (uniqueTokens.length === 0) {
      return [];
    }

    const content = this.buildMessageContent(notification);
    const batches = this.chunkTokens(uniqueTokens);

    // Each batch is an independent multicast call. `sendBatch` never rejects, so
    // one failed batch cannot discard the results of the batches that succeeded.
    const batchOutcomes = await Promise.all(batches.map((batch) => this.sendBatch(batch, content)));

    return batchOutcomes.flat();
  }

  // Sends one batch and returns an outcome per token. If the whole call fails
  // (network, auth, quota, etc.), every token in the batch is reported as failed
  // instead of throwing, so the caller still gets the other batches' results.
  private async sendBatch(batch: string[], content: FcmMessageContent): Promise<FcmSendOutcome[]> {
    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens: batch,
        notification: content.notification,
        data: content.data,
      });

      return response.responses.map((result, index) => this.toOutcome(batch[index], result));
    } catch (error) {
      // A batch-level failure is transient/unknown, so isInvalidToken stays false
      // and none of these registrations are cleaned up.
      const errorCode = this.extractErrorCode(error);
      return batch.map((token) => ({ token, success: false, isInvalidToken: false, errorCode }));
    }
  }

  // FirebaseError carries a string `code`. Pull it out for logging without
  // assuming the error shape; never return the raw error or any token.
  private extractErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  // Maps the value object to FCM's shape. Title/body/imageUrl go into the visible
  // notification; eventType and custom data go into the data payload.
  private buildMessageContent(notification: PushNotification): FcmMessageContent {
    const content: Notification = {
      title: notification.getTitle(),
      body: notification.getBody(),
    };

    const imageUrl = notification.getImageUrl();
    if (imageUrl) {
      content.imageUrl = imageUrl;
    }

    // Spread custom data first, then set eventType last so custom data can never
    // overwrite the event type the frontend relies on.
    const data: Record<string, string> = {
      ...(notification.getData() ?? {}),
      eventType: notification.getEventType(),
    };

    return { notification: content, data };
  }

  // Split the tokens into groups no larger than FCM's per-call limit.
  private chunkTokens(tokens: string[]): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < tokens.length; index += FCM_MULTICAST_TOKEN_LIMIT) {
      chunks.push(tokens.slice(index, index + FCM_MULTICAST_TOKEN_LIMIT));
    }
    return chunks;
  }

  private toOutcome(token: string, response: SendResponse): FcmSendOutcome {
    if (response.success) {
      return { token, success: true, isInvalidToken: false };
    }

    const errorCode = response.error?.code;

    return {
      token,
      success: false,
      isInvalidToken: errorCode !== undefined && FCM_INVALID_TOKEN_ERROR_CODES.includes(errorCode),
      errorCode,
    };
  }
}
