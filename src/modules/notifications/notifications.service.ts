import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';
import { FcmPushAdapter } from './infrastructure/fcm-push.adapter';
import { PushRegistrationFields, PushRegistration } from './domain/push-registration.entity';
import { PushRegistrationValidationError } from './domain/push-registration.errors';
import { PinoLogger } from 'nestjs-pino';
import { NotificationEvents } from './notifications.constants';
import { NotificationMessages } from './notifications.constants';
import type {
  FcmSendOutcome,
  SendPushResult,
  SendPushToUsersInput,
  UnregisterPushNotificationInput,
} from './notifications.types';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly pushRegistrationsRepository: PushRegistrationsRepository,
    private readonly fcmPushAdapter: FcmPushAdapter,
    private readonly logger: PinoLogger,
  ) {}

  // *** REGISTER PUSH NOTIFICATION ***
  async registerPushNotification(registration: PushRegistrationFields): Promise<void> {
    this.assertAuthenticated(registration.userId);

    let pushRegistration: PushRegistration;
    try {
      pushRegistration = PushRegistration.create(registration);
    } catch (error) {
      // The domain layer throws its own error type so it stays free of NestJS.
      // At this HTTP boundary we turn that into a 400 Bad Request. Any other
      // error is unexpected, so we let it bubble up unchanged.
      if (error instanceof PushRegistrationValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    await this.pushRegistrationsRepository.save(pushRegistration);

    this.logger.info(
      {
        event: NotificationEvents.PUSH_REGISTRATION_CREATED,
        installationId: registration.installationId,
        userId: registration.userId,
      },
      NotificationMessages.PUSH_CREATED_MESSAGE,
    );
  }

  // *** UNREGISTER PUSH NOTIFICATION ***
  async unregisterPushNotification(input: UnregisterPushNotificationInput): Promise<void> {
    this.assertAuthenticated(input.userId);
    const userId = input.userId;

    const installationId = input.installationId?.trim();
    if (!installationId || installationId.includes('/')) {
      throw new BadRequestException('Invalid installation ID');
    }

    const result = await this.pushRegistrationsRepository.deleteOwnedRegistration(
      installationId,
      userId,
    );

    // 'deleted' and 'missing' both count as success: the caller just wants this
    // registration gone, and deleting something twice should be safe (idempotent).
    // Only 'not-owned' is an error, since the registration belongs to someone else.
    if (result === 'not-owned') {
      throw new ForbiddenException('You cannot remove this push registration');
    }
  }

  // *** SEND PUSH NOTIFICATION TO USERS ***
  // Delivers one notification's content to every device of the given users and
  // reports how it went. Recipient selection and Firestore cleanup live here; the
  // adapter only talks to FCM. The steps below read top-to-bottom; each detail is
  // in its own helper.
  async sendToUsers(input: SendPushToUsersInput): Promise<SendPushResult> {
    const userIds = this.normalizeUserIds(input.userIds);
    if (userIds.length === 0) {
      return this.emptyResult();
    }

    const registrations = await this.pushRegistrationsRepository.findByUserIds(userIds);
    const usersWithoutRegistrationsCount = this.countUsersWithoutRegistrations(
      userIds,
      registrations,
    );

    const installationsByToken = this.mapTokensToInstallations(registrations);
    const tokens = [...installationsByToken.keys()];
    if (tokens.length === 0) {
      // No devices to reach, but still report how many users had none.
      return { ...this.emptyResult(), usersWithoutRegistrationsCount };
    }

    const outcomes = await this.fcmPushAdapter.send(tokens, input.notification);
    await this.removeInvalidRegistrations(outcomes, installationsByToken);

    // Targets are counted by unique tokens (devices), not users.
    const result: SendPushResult = {
      targetCount: tokens.length,
      acceptedCount: outcomes.filter((outcome) => outcome.success).length,
      failedCount: outcomes.filter((outcome) => !outcome.success).length,
      usersWithoutRegistrationsCount,
    };

    this.logSendResult(result, outcomes);
    return result;
  }

  private emptyResult(): SendPushResult {
    return { targetCount: 0, acceptedCount: 0, failedCount: 0, usersWithoutRegistrationsCount: 0 };
  }

  // Trim, drop blanks, and remove duplicate recipient IDs.
  private normalizeUserIds(userIds: readonly string[]): string[] {
    return [...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  }

  // How many of the requested users have no registration at all.
  private countUsersWithoutRegistrations(
    userIds: string[],
    registrations: PushRegistration[],
  ): number {
    const usersWithRegistrations = new Set(registrations.map((r) => r.getUserId()));
    return userIds.filter((id) => !usersWithRegistrations.has(id)).length;
  }

  // Unique FCM token -> every installation that reported that token. We send once
  // per unique token, but the same token can appear on more than one installation
  // (e.g. a reinstalled app), so all of them must be cleaned up if it goes invalid.
  private mapTokensToInstallations(registrations: PushRegistration[]): Map<string, string[]> {
    const installationsByToken = new Map<string, string[]>();
    for (const registration of registrations) {
      const token = registration.getRegistrationId();
      const installationId = registration.getInstallationId();

      const installations = installationsByToken.get(token) ?? [];
      if (!installations.includes(installationId)) {
        installations.push(installationId);
      }
      installationsByToken.set(token, installations);
    }
    return installationsByToken;
  }

  // Remove every registration for a token FCM confirmed as invalid. The repository
  // deletes conditionally, so a device that refreshed its token meanwhile is left
  // untouched. Transient failures are not deleted, so they retry on the next send.
  private async removeInvalidRegistrations(
    outcomes: FcmSendOutcome[],
    installationsByToken: Map<string, string[]>,
  ): Promise<void> {
    const deletions: Promise<boolean>[] = [];

    for (const outcome of outcomes) {
      if (!outcome.isInvalidToken) {
        continue;
      }

      const installationIds = installationsByToken.get(outcome.token) ?? [];
      for (const installationId of installationIds) {
        deletions.push(
          this.pushRegistrationsRepository.deleteIfTokenMatches(installationId, outcome.token),
        );
      }
    }

    await Promise.all(deletions);
  }

  // Log counts and safe FCM error codes only — never the tokens themselves.
  private logSendResult(result: SendPushResult, outcomes: FcmSendOutcome[]): void {
    const errorCodes = [
      ...new Set(
        outcomes
          .filter((outcome) => !outcome.success && outcome.errorCode)
          .map((outcome) => outcome.errorCode),
      ),
    ];

    this.logger.info(
      {
        event: NotificationEvents.PUSH_SEND_COMPLETED,
        ...result,
        invalidTokenCount: outcomes.filter((outcome) => outcome.isInvalidToken).length,
        errorCodes,
      },
      NotificationMessages.PUSH_SEND_COMPLETED_MESSAGE,
    );
  }

  // Rejects the request if there is no signed-in user. The `asserts userId is
  // string` return type tells TypeScript that once this passes, `userId` is
  // definitely a string, so the rest of the method needs no extra null checks.
  private assertAuthenticated(userId: string | undefined): asserts userId is string {
    if (!userId || userId.trim() === '') {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }
}
