import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { PH_MOBILE_NUMBER_PATTERN, SMS_SENDER } from '@/infra/sms/sms.constants';
import type { SmsSender } from '@/infra/sms/sms-sender.interface';
import type { SmsSendResult } from '@/infra/sms/sms.types';
import { SOS_EMAIL_SENDER, type SosEmailSender } from '@/infra/email/sos-email.sender';
import { ProfileService } from '../profile/profile.service';
import { AlertsService } from '../alerts/alerts.service';
import { SosRepository } from './infrastructure/sos.repository';
import { composeEndMessage, composeInitialMessage } from './sos-message';
import {
  SOS_JOB_EXPIRY_MS,
  SOS_LOCATION_MAX_AGE_MS,
  SOS_LOCATION_MAX_FUTURE_MS,
  SOS_RECOVERY_INTERVAL_MS,
  SOS_SEND_GRACE_MS,
} from './sos.constants';
import type { StartSosDto } from './sos.dto';
import type {
  PublicSos,
  SosLocation,
  SosRecipient,
  SosRecord,
  EmailSubmission,
  SubmissionSummary,
} from './sos.types';
import { idleRefresh } from './sos.types';
import { acceptedWork, endEligible, needsRecovery } from './sos-delivery';
import { SosDeliveryWorker } from './sos-delivery.worker';

const FALLBACK_NAME = 'A RideGuard user';

export type StartSosResult = { sos: PublicSos; created: boolean };

type SendClaim = { phone: string; text: string } | null;

// +639123456789 -> +639******789
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(phone.length - 7, 0))}${phone.slice(-3)}`;
}

// Manual SOS lifecycle and SMS dispatch.
//
// Transactional queued -> sending claims prevent duplicate submissions.
// Recovery never reclaims a sending attempt for resubmission.
@Injectable()
export class SosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SosService.name);
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private recovering = false;

  constructor(
    private readonly repository: SosRepository,
    private readonly profileService: ProfileService,
    @Inject(SMS_SENDER) private readonly smsSender: SmsSender,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly alertsService: AlertsService,
    private readonly deliveryWorker: SosDeliveryWorker,
    @Optional() @Inject(SOS_EMAIL_SENDER) private readonly emailSender?: SosEmailSender,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get('SOS_ENABLED', { infer: true })) return;
    void this.recover();
    this.recoveryTimer = setInterval(() => void this.recover(), SOS_RECOVERY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  async recover(): Promise<void> {
    if (this.recovering || !this.configService.get('SOS_ENABLED', { infer: true })) return;
    this.recovering = true;
    try {
      let afterId: string | undefined;
      for (;;) {
        const page = await this.repository.listNeedingRecovery(afterId);
        if (page.length === 0) break;
        for (const record of page) {
          if (!needsRecovery(record)) continue;
          try {
            await this.recoverRecord(record.sosId);
          } catch {
            this.logger.error(`SOS ${record.sosId}: recovery failed`);
          }
        }
        afterId = page[page.length - 1].sosId;
      }
    } catch {
      this.logger.error('SOS recovery scan failed');
    } finally {
      this.recovering = false;
    }
  }
  private async recoverRecord(sosId: string): Promise<void> {
    // Longer than either supported adapter's bounded HTTP timeout. Recheck
    // persisted state inside the transaction so another process can stay live.
    const staleAfter =
      Math.max(
        this.configService.get('TEXTBEE_TIMEOUT_MS', { infer: true }),
        this.configService.get('SMS_API_PH_TIMEOUT_MS', { infer: true }),
      ) + SOS_SEND_GRACE_MS;
    const pending = await this.repository.mutate(sosId, (record) => {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      for (const recipient of record.recipients) {
        for (const which of ['initial', 'ended'] as const) {
          const current = recipient[which];
          if (!current) continue;
          if (current.status === 'sending' && now - Date.parse(current.updatedAt) > staleAfter) {
            recipient[which] = this.summary('unknown', nowIso, 'interrupted');
          } else if (current.status === 'queued') {
            const queuedAt = which === 'initial' ? record.createdAt : current.updatedAt;
            if (which === 'initial' && record.status === 'ended') {
              recipient.initial = this.summary('cancelled', nowIso);
            } else if (now - Date.parse(queuedAt) > SOS_JOB_EXPIRY_MS) {
              recipient[which] = this.summary('failed', nowIso, 'expired');
            }
          }
        }
        for (const which of ['initialEmail', 'endedEmail'] as const) {
          const current = recipient[which];
          if (!current) continue;
          if (current.status === 'sending' && now - Date.parse(current.updatedAt) > staleAfter) {
            recipient[which] = this.emailSummary('unknown', nowIso, 'interrupted');
          } else if (current.status === 'queued' && now - Date.parse(current.updatedAt) > SOS_JOB_EXPIRY_MS) {
            recipient[which] = this.emailSummary('failed', nowIso, 'expired');
          }
        }
        for (const which of ['initialEmail', 'endedEmail'] as const) {
          const current = recipient[which];
          if (!current) continue;
          if (current.status === 'sending' && now - Date.parse(current.updatedAt) > staleAfter) {
            recipient[which] = this.emailSummary('unknown', nowIso, 'interrupted');
          } else if (current.status === 'queued' && now - Date.parse(current.updatedAt) > SOS_JOB_EXPIRY_MS) {
            recipient[which] = this.emailSummary('failed', nowIso, 'expired');
          }
        }
        // An interrupted initial send may have reached the contact. Ending
        // that SOS needs one distinct follow-up, never a repeated initial.
        if (
          record.status === 'ended' &&
          recipient.ended === null &&
          endEligible(recipient)
        ) {
          recipient.ended = this.summary('queued', nowIso);
        }
        if (record.status === 'ended' && recipient.endedEmail === null) {
          recipient.endedEmail = recipient.email
            ? this.emailSummary('queued', nowIso)
            : this.emailSummary('failed', nowIso, 'email_unavailable');
        }
      }
      return record.recipients.map((r) => ({
        contactId: r.contactId,
        initial: r.initial.status === 'queued',
        ended: r.ended?.status === 'queued',
        initialEmail: r.initialEmail?.status === 'queued',
        endedEmail: r.endedEmail?.status === 'queued',
      }));
    });
    for (const recipient of pending ?? []) {
      if (recipient.initial) await this.sendInitial(sosId, recipient.contactId);
      if (recipient.ended) await this.sendEnd(sosId, recipient.contactId);
      if (recipient.initialEmail) await this.sendInitialEmail(sosId, recipient.contactId);
      if (recipient.endedEmail) await this.sendEndEmail(sosId, recipient.contactId);
    }
  }

  async start(uid: string, dto: StartSosDto): Promise<StartSosResult> {
    const fingerprint = this.fingerprint(dto);

    // A finished request must replay, never create another SOS, so resolve
    // the mapping before contact revalidation or the enabled flag.
    const replay = await this.repository.findByRequest(uid, dto.requestId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw this.requestConflict();
      return { sos: this.toPublic(replay.record), created: false };
    }

    if (!this.configService.get('SOS_ENABLED', { infer: true })) {
      throw new ServiceUnavailableException({
        message: 'SOS is not enabled',
        code: 'SOS_DISABLED',
      });
    }

    if (dto.alertId) await this.alertsService.getOwned(dto.alertId, uid);

    const now = new Date();
    const location = this.acceptLocation(dto.location, now);
    const recipients = await this.buildRecipients(uid, now);
    const requesterName = await this.requesterName(uid);

    const candidate: SosRecord = {
      sosId: this.repository.newId(),
      uid,
      requestId: dto.requestId,
      alertId: dto.alertId ?? null,
      status: 'active',
      requesterName,
      createdAt: now.toISOString(),
      endedAt: null,
      location,
      recipients,
    };

    const outcome = await this.repository.startOrGet(uid, dto.requestId, fingerprint, candidate);
    if (outcome.kind === 'conflict') throw this.requestConflict();

    if (outcome.kind === 'created') {
      void this.dispatchInitial(outcome.record);
    }
    return { sos: this.toPublic(outcome.record), created: outcome.kind === 'created' };
  }

  async getActive(uid: string): Promise<PublicSos | null> {
    const record = await this.repository.getActive(uid);
    return record ? this.toPublic(record) : null;
  }

  async getOwned(uid: string, sosId: string): Promise<PublicSos> {
    return this.toPublic(await this.findOwned(uid, sosId));
  }

  async refreshStatus(uid: string, sosId: string) {
    const result = await this.deliveryWorker.request(uid, sosId);
    return { scheduled: result.scheduled, sos: this.toPublic(result.record) };
  }

  async getByRequest(uid: string, requestId: string): Promise<PublicSos> {
    const mapping = await this.repository.findByRequest(uid, requestId);
    if (!mapping || mapping.record.uid !== uid) throw new NotFoundException('SOS not found');
    return this.toPublic(mapping.record);
  }

  async getByAlert(uid: string, alertId: string): Promise<PublicSos | null> {
    await this.alertsService.getOwned(alertId, uid);
    const record = await this.repository.findLatestByAlert(uid, alertId);
    return record ? this.toPublic(record) : null;
  }

  async stop(uid: string, sosId: string): Promise<PublicSos> {
    await this.findOwned(uid, sosId);
    const outcome = await this.repository.mutateAndRelease(uid, sosId, (record) => {
      const endContactIds: string[] = [];
      const endEmailContactIds: string[] = [];
      if (record.status === 'ended') return { record, endContactIds, endEmailContactIds };

      const nowIso = new Date().toISOString();
      record.status = 'ended';
      record.endedAt = nowIso;
      for (const recipient of record.recipients) {
        if (recipient.initial.status === 'queued') {
          recipient.initial = this.summary('cancelled', nowIso);
        } else if (endEligible(recipient)) {
          // Only these may have reached the contact, so only they get an end
          // update. A 'sending' recipient gets one when its result lands.
          recipient.ended = this.summary('queued', nowIso);
          endContactIds.push(recipient.contactId);
        }
        if (recipient.endedEmail === null) {
          recipient.endedEmail = recipient.email
            ? this.emailSummary('queued', nowIso)
            : this.emailSummary('failed', nowIso, 'email_unavailable');
          if (recipient.email) endEmailContactIds.push(recipient.contactId);
        }
      }
      return { record, endContactIds, endEmailContactIds };
    });
    if (!outcome) throw new NotFoundException('SOS not found');

    for (const contactId of outcome.endContactIds) {
      void this.sendEnd(sosId, contactId);
    }
    for (const contactId of outcome.endEmailContactIds) void this.sendEndEmail(sosId, contactId);
    return this.toPublic(outcome.record);
  }

  // ---- activation helpers -------------------------------------------------

  private fingerprint(dto: StartSosDto): string {
    const location = dto.location;
    return JSON.stringify([
      dto.requestId,
      location
        ? [
            location.latitude,
            location.longitude,
            new Date(location.capturedAt).toISOString(),
            location.accuracyMeters ?? null,
          ]
        : null,
      // Preserve the two-element fingerprint for older unlinked requests.
      ...(dto.alertId ? [dto.alertId] : []),
    ]);
  }

  private requestConflict(): HttpException {
    return new ConflictException({
      message: 'This requestId was already used with different input',
      code: 'SOS_REQUEST_CONFLICT',
    });
  }

  // Missing or stale location never blocks an otherwise valid SOS; a capture
  // time in the future is a client error.
  private acceptLocation(input: StartSosDto['location'], now: Date): SosLocation | null {
    if (!input) return null;
    const capturedMs = new Date(input.capturedAt).getTime();
    if (capturedMs - now.getTime() > SOS_LOCATION_MAX_FUTURE_MS) {
      throw new BadRequestException('location.capturedAt is in the future');
    }
    if (now.getTime() - capturedMs > SOS_LOCATION_MAX_AGE_MS) return null;
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      capturedAt: new Date(capturedMs).toISOString(),
      accuracyMeters: input.accuracyMeters ?? null,
    };
  }

  // Snapshot of usable contacts: valid PH numbers, one per number, stable
  // order by contact id. Contact edits after this point do not affect it.
  private async buildRecipients(uid: string, now: Date): Promise<SosRecipient[]> {
    const contacts = (await this.profileService.listContacts(uid))
      .filter((contact) => PH_MOBILE_NUMBER_PATTERN.test(contact.phone))
      .sort((a, b) => a.id.localeCompare(b.id));

    const seen = new Set<string>();
    const recipients: SosRecipient[] = [];
    for (const contact of contacts) {
      if (seen.has(contact.phone)) continue;
      seen.add(contact.phone);
      recipients.push({
        contactId: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email ?? '',
        initial: this.summary('queued', now.toISOString()),
        initialEmail: contact.email
          ? this.emailSummary('queued', now.toISOString())
          : this.emailSummary('failed', now.toISOString(), 'email_unavailable'),
        ended: null,
        endedEmail: null,
      });
    }

    if (recipients.length === 0) {
      throw new UnprocessableEntityException({
        message: 'No usable emergency contacts',
        code: 'SOS_NO_CONTACTS',
      });
    }
    return recipients;
  }

  private async requesterName(uid: string): Promise<string> {
    const profile = await this.profileService.getProfile(uid);
    const info = profile?.personalInfo as { firstName?: unknown; lastName?: unknown } | undefined;
    const parts = [info?.firstName, info?.lastName].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    );
    return parts.length > 0 ? parts.join(' ') : FALLBACK_NAME;
  }

  // ---- dispatch -----------------------------------------------------------

  private async dispatchInitial(record: SosRecord): Promise<void> {
    await Promise.allSettled(
      record.recipients.map((recipient) => this.sendInitial(record.sosId, recipient.contactId)),
    );
    await Promise.allSettled(
      record.recipients.map((recipient) => this.sendInitialEmail(record.sosId, recipient.contactId)),
    );
  }

  private async sendInitial(sosId: string, contactId: string): Promise<void> {
    if (!this.configService.get('SOS_ENABLED', { infer: true })) return;
    try {
      const claim = await this.repository.mutate<SendClaim>(sosId, (record) => {
        const recipient = this.find(record, contactId);
        if (recipient.initial.status !== 'queued') return null;
        const nowIso = new Date().toISOString();

        if (record.status === 'ended') {
          recipient.initial = this.summary('cancelled', nowIso);
          return null;
        }
        if (Date.now() - Date.parse(record.createdAt) > SOS_JOB_EXPIRY_MS) {
          recipient.initial = this.summary('failed', nowIso, 'expired');
          return null;
        }
        const composed = composeInitialMessage(record.requesterName, record.location, Boolean(recipient.email));
        if (!composed) {
          recipient.initial = this.summary('failed', nowIso, 'message_too_long');
          return null;
        }
        recipient.initial = this.summary('sending', nowIso);
        return { phone: recipient.phone, text: composed.text };
      });
      if (!claim) return;

      const result = await this.smsSender.send({ recipient: claim.phone, message: claim.text });
      const summary = this.fromSendResult(result);
      const work = acceptedWork(result, summary);
      const providerMessageId =
        result.outcome === 'accepted' ? result.providerMessageId : undefined;

      const needsEnd = await this.repository.mutate(sosId, (record) => {
        const recipient = this.find(record, contactId);
        recipient.initial = summary;
        if (work) recipient.initialWork = work;
        if (providerMessageId) recipient.providerMessageId = providerMessageId;
        // Stopped while this send was in flight: it may still have reached
        // the contact, so follow up exactly once.
        if (
          record.status === 'ended' &&
          recipient.ended === null &&
          endEligible(recipient)
        ) {
          recipient.ended = this.summary('queued', new Date().toISOString());
          recipient.endedEmail = recipient.email
            ? this.emailSummary('queued', new Date().toISOString())
            : this.emailSummary('failed', new Date().toISOString(), 'email_unavailable');
          return true;
        }
        return false;
      });
      if (work) this.deliveryWorker.wake();

      this.logger.log(`SOS ${sosId}: initial send ${summary.status}`);
      if (needsEnd) {
        await this.sendEnd(sosId, contactId);
        await this.sendEndEmail(sosId, contactId);
      }
    } catch (error) {
      await this.markInterrupted(sosId, contactId, 'initial', error);
    }
  }

  private async sendEnd(sosId: string, contactId: string): Promise<void> {
    if (!this.configService.get('SOS_ENABLED', { infer: true })) return;
    try {
      const claim = await this.repository.mutate<SendClaim>(sosId, (record) => {
        const recipient = this.find(record, contactId);
        const nowIso = new Date().toISOString();
        if (recipient.ended?.status !== 'queued') return null;
        // The initial send is still in flight; its result handler resumes this.
        if (recipient.initial.status === 'sending') return null;

        const endedAt = record.endedAt ?? nowIso;
        const text = composeEndMessage(record.requesterName, new Date(endedAt));
        if (!text) {
          recipient.ended = this.summary('failed', nowIso, 'message_too_long');
          return null;
        }
        if (Date.now() - Date.parse(recipient.ended.updatedAt) > SOS_JOB_EXPIRY_MS) {
          recipient.ended = this.summary('failed', nowIso, 'expired');
          return null;
        }
        recipient.ended = this.summary('sending', nowIso);
        return { phone: recipient.phone, text };
      });
      if (!claim) return;

      const result = await this.smsSender.send({ recipient: claim.phone, message: claim.text });
      const summary = this.fromSendResult(result);
      const work = acceptedWork(result, summary);
      await this.repository.mutate(sosId, (record) => {
        this.find(record, contactId).ended = summary;
        if (work) this.find(record, contactId).endedWork = work;
      });
      if (work) this.deliveryWorker.wake();
      this.logger.log(`SOS ${sosId}: end update ${summary.status}`);
    } catch (error) {
      await this.markInterrupted(sosId, contactId, 'ended', error);
    }
  }

  private async sendInitialEmail(sosId: string, contactId: string): Promise<void> {
    if (!this.emailSender) return;
    const claim = await this.repository.mutate(sosId, (record) => {
      const recipient = this.find(record, contactId);
      if (!recipient.email || recipient.initialEmail?.status !== 'queued') return null;
      recipient.initialEmail = this.emailSummary('sending', new Date().toISOString());
      return { to: recipient.email, requesterName: record.requesterName, location: record.location, createdAt: record.createdAt };
    });
    if (!claim) return;
    try {
      await this.emailSender.sendStart(claim);
      await this.repository.mutate(sosId, (record) => {
        this.find(record, contactId).initialEmail = this.emailSummary('sent', new Date().toISOString());
      });
    } catch {
      await this.repository.mutate(sosId, (record) => {
        this.find(record, contactId).initialEmail = this.emailSummary('failed', new Date().toISOString(), 'delivery_failed');
      });
    }
  }

  private async sendEndEmail(sosId: string, contactId: string): Promise<void> {
    if (!this.emailSender) return;
    const claim = await this.repository.mutate(sosId, (record) => {
      const recipient = this.find(record, contactId);
      if (!recipient.email || recipient.endedEmail?.status !== 'queued') return null;
      recipient.endedEmail = this.emailSummary('sending', new Date().toISOString());
      return { to: recipient.email, requesterName: record.requesterName, location: record.location, endedAt: record.endedAt ?? new Date().toISOString() };
    });
    if (!claim) return;
    try {
      await this.emailSender.sendEnd(claim);
      await this.repository.mutate(sosId, (record) => {
        this.find(record, contactId).endedEmail = this.emailSummary('sent', new Date().toISOString());
      });
    } catch {
      await this.repository.mutate(sosId, (record) => {
        this.find(record, contactId).endedEmail = this.emailSummary('failed', new Date().toISOString(), 'delivery_failed');
      });
    }
  }

  // Unexpected error after a claim: the provider may or may not have the
  // message, so record uncertainty rather than leaving 'sending' forever.
  private async markInterrupted(
    sosId: string,
    contactId: string,
    which: 'initial' | 'ended',
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `SOS ${sosId}: ${which} dispatch interrupted (${error instanceof Error ? error.name : 'error'})`,
    );
    try {
      await this.repository.mutate(sosId, (record) => {
        const recipient = this.find(record, contactId);
        const current = which === 'initial' ? recipient.initial : recipient.ended;
        if (current?.status !== 'sending') return;
        const summary = this.summary('unknown', new Date().toISOString(), 'dispatch_error');
        if (which === 'initial') recipient.initial = summary;
        else recipient.ended = summary;
      });
    } catch {
      this.logger.error(`SOS ${sosId}: could not record interrupted dispatch`);
    }
  }

  // ---- mapping ------------------------------------------------------------

  private fromSendResult(result: SmsSendResult): SubmissionSummary {
    const nowIso = new Date().toISOString();
    switch (result.outcome) {
      case 'accepted':
        return this.summary('accepted', nowIso);
      case 'rejected':
        return this.summary('failed', nowIso, result.reason);
      default:
        return this.summary('unknown', nowIso, result.reason);
    }
  }

  private summary(
    status: SubmissionSummary['status'],
    updatedAt: string,
    errorCode?: string,
  ): SubmissionSummary {
    return errorCode ? { status, updatedAt, errorCode, delivery: null } : { status, updatedAt, delivery: null };
  }

  private emailSummary(status: EmailSubmission['status'], updatedAt: string, errorCode?: string): EmailSubmission {
    return errorCode ? { status, updatedAt, errorCode } : { status, updatedAt };
  }

  private find(record: SosRecord, contactId: string): SosRecipient {
    const recipient = record.recipients.find((item) => item.contactId === contactId);
    if (!recipient) throw new Error('recipient missing');
    return recipient;
  }

  private async findOwned(uid: string, sosId: string): Promise<SosRecord> {
    const record = await this.repository.get(sosId);
    // Foreign and absent records look the same.
    if (!record || record.uid !== uid) throw new NotFoundException('SOS not found');
    return record;
  }

  // Backend-only fields (uid, requester name, full phone, provider id) never
  // leave the service.
  private toPublic(record: SosRecord): PublicSos {
    return {
      sosId: record.sosId,
      requestId: record.requestId,
      alertId: record.alertId ?? null,
      status: record.status,
      createdAt: record.createdAt,
      endedAt: record.endedAt,
      location: record.location,
      statusRefresh: record.statusRefresh ?? idleRefresh(),
      recipients: record.recipients.map((recipient) => ({
        contactId: recipient.contactId,
        name: recipient.name,
        phone: maskPhone(recipient.phone),
        email: recipient.email ?? '',
        initialEmail: recipient.initialEmail ?? this.emailSummary('unknown', recipient.initial.updatedAt, 'unavailable'),
        endedEmail: recipient.endedEmail ?? null,
        initial: { ...recipient.initial, delivery: recipient.initial.delivery ?? null },
        ended: recipient.ended ? { ...recipient.ended, delivery: recipient.ended.delivery ?? null } : null,
      })),
    };
  }
}
