import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { SmsDeliveryTracker } from '@/infra/sms/sms-delivery-tracker';
import { SosRepository } from './infrastructure/sos.repository';
import { applyLookup, finishRefresh, messageKinds, terminal, workFor } from './sos-delivery';
import type { MessageKind } from './sos.types';

@Injectable()
export class SosDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private inFlight = 0;
  private readonly logger = new Logger(SosDeliveryWorker.name);
  constructor(
    private readonly repository: SosRepository,
    private readonly tracker: SmsDeliveryTracker,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit() {
    // Status-only capability intentionally does not depend on SOS_ENABLED.
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async request(uid: string, sosId: string) {
    const outcome = await this.repository.mutateTracking(sosId, (record) => {
      if (record.uid !== uid) throw new NotFoundException('SOS not found');
      const now = Date.now();
      finishRefresh(record, now);
      const old = record.statusRefresh;
      if (old?.state === 'pending') return { scheduled: true, record };
      if (old?.nextAllowedAt && Date.parse(old.nextAllowedAt) > now)
        return { scheduled: false, record };
      const targets = record.recipients.flatMap((r) =>
        messageKinds.flatMap((which) => {
          const work = workFor(r, which);
          const summary = r[which];
          if (!work || !summary?.delivery || terminal(summary)) return [];
          const fresh =
            summary.delivery.lastCheckedAt &&
            now - Date.parse(summary.delivery.lastCheckedAt) < 5000;
          // Preserve an in-flight claim. Otherwise make a single check due now.
          if (!fresh && !work.leaseUntil) work.dueAt = now;
          return [
            {
              contactId: r.contactId,
              which,
              result: fresh ? ('ok' as const) : ('pending' as const),
            },
          ];
        }),
      );
      if (!targets.length) return { scheduled: false, record };
      record.refreshTargets = targets;
      record.statusRefresh = {
        state: 'pending',
        requestedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
        nextAllowedAt: new Date(now + 30000).toISOString(),
      };
      finishRefresh(record, now);
      return { scheduled: true, record };
    });
    if (!outcome) throw new NotFoundException('SOS not found');
    return outcome;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const records = await this.repository.listDeliveryDue(Date.now());
      const jobs: Promise<void>[] = [];
      for (const record of records) {
        // Expiry/finalization still runs when both HTTP slots are occupied.
        await this.repository.mutateTracking(record.sosId, (saved) => {
          finishRefresh(saved, Date.now());
          for (const r of saved.recipients)
            for (const kind of messageKinds) {
              const d = r[kind]?.delivery;
              if (d?.tracking === 'active' && Date.now() >= Date.parse(d.expiresAt))
                d.tracking = 'timed_out';
            }
        });
        for (const r of record.recipients)
          for (const kind of messageKinds) {
            if (this.inFlight >= 2) break;
            const work = workFor(r, kind);
            const d = r[kind]?.delivery;
            const manual =
              record.statusRefresh?.state === 'pending' &&
              record.refreshTargets?.some(
                (t) => t.contactId === r.contactId && t.which === kind && t.result === 'pending',
              );
            if (
              !work ||
              !d ||
              terminal(r[kind]) ||
              work.dueAt > Date.now() ||
              work.leaseUntil > Date.now() ||
              (!manual && (d.tracking !== 'active' || Date.now() >= Date.parse(d.expiresAt)))
            )
              continue;
            this.inFlight++;
            jobs.push(
              this.check(record.sosId, r.contactId, kind).finally(() => {
                this.inFlight--;
              }),
            );
          }
      }
      // Keep scheduling while requests run, so a hanging request cannot hold up job expiry.
      void Promise.allSettled(jobs);
    } catch {
      this.logger.warn('SOS delivery scheduling failed');
    } finally {
      this.running = false;
    }
  }

  async check(sosId: string, contactId: string, which: MessageKind): Promise<void> {
    const claim = await this.repository.mutateTracking(sosId, (record, cooldown) => {
      const now = Date.now();
      finishRefresh(record, now);
      const recipient = record.recipients.find((r) => r.contactId === contactId);
      if (!recipient) return null;
      const summary = recipient[which];
      const work = workFor(recipient, which);
      if (!work || !summary?.delivery || terminal(summary)) return null;
      const d = summary.delivery;
      const target =
        record.statusRefresh?.state === 'pending' &&
        record.refreshTargets?.find(
          (t) => t.contactId === contactId && t.which === which && t.result === 'pending',
        );
      if (!target && (d.tracking !== 'active' || now >= Date.parse(d.expiresAt))) return null;
      if (work.leaseUntil > now || work.dueAt > now) return null;
      if (cooldown.until > now) {
        work.dueAt = cooldown.until;
        return null;
      }
      work.revision++;
      work.leaseUntil =
        now + Math.max(30000, this.config.get('TEXTBEE_TIMEOUT_MS', { infer: true }) + 10000);
      d.lastAttemptAt = new Date(now).toISOString();
      return {
        revision: work.revision,
        providerMessageId: work.providerMessageId,
        deviceId: work.deviceId,
      };
    });
    if (!claim) return;
    const result = await this.tracker
      .check(claim.providerMessageId, claim.deviceId)
      .catch(() => ({ state: 'unknown' as const, reason: 'network_error' as const }));
    await this.repository.mutateTracking(sosId, (record, cooldown) => {
      const recipient = record.recipients.find((r) => r.contactId === contactId);
      if (!recipient) return;
      const summary = recipient[which];
      const work = workFor(recipient, which);
      if (!work || !summary?.delivery || work.revision !== claim.revision) return;
      const now = Date.now();
      applyLookup(summary, work, result, now);
      if (result.state === 'unknown' && result.reason === 'rate_limited')
        cooldown.until = Math.max(cooldown.until, now + (result.retryAfterMs ?? 60000));
      // Finish expired jobs first. Late evidence is valid, but cannot revive a job.
      finishRefresh(record, now);
      if (record.statusRefresh?.state === 'pending') {
        const target = record.refreshTargets?.find(
          (t) => t.contactId === contactId && t.which === which && t.result === 'pending',
        );
        if (target)
          target.result =
            result.state !== 'unknown' || result.reason === 'provider_unknown' ? 'ok' : 'error';
        finishRefresh(record, now);
      }
    });
  }
}
