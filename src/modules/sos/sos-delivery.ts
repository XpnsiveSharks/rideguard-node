import type { SmsSendResult, SmsDeliveryStatus } from '@/infra/sms/sms.types';
import type {
  SosRecipient,
  SosRecord,
  SubmissionSummary,
  DeliveryWork,
  MessageKind,
} from './sos.types';
import { SOS_DELIVERY_TRACK_TIMEOUT_MS } from './sos.constants';

export const messageKinds = ['initial', 'ended'] as const;
export const workFor = (r: SosRecipient, kind: MessageKind) =>
  r[kind === 'initial' ? 'initialWork' : 'endedWork'];
export const terminal = (s: SubmissionSummary | null) =>
  s?.delivery?.status === 'delivered' || s?.delivery?.status === 'failed';
export const endEligible = (r: SosRecipient) =>
  (r.initial.status === 'accepted' || r.initial.status === 'unknown') &&
  r.initial.delivery?.status !== 'failed';

// A submission is queued/sending, or an ended SOS still owes an end update.
export const needsRecovery = (record: SosRecord): boolean =>
  record.recipients.some(
    (r) =>
      r.initial.status === 'queued' ||
      r.initial.status === 'sending' ||
      r.ended?.status === 'queued' ||
      r.ended?.status === 'sending' ||
      r.initialEmail?.status === 'queued' ||
      r.initialEmail?.status === 'sending' ||
      r.endedEmail?.status === 'queued' ||
      r.endedEmail?.status === 'sending' ||
      (record.status === 'ended' && r.ended === null && endEligible(r)),
  );

// Indexed scalars recomputed on every SOS write.
export function updateIndexedFields(record: SosRecord): void {
  updateDeliveryDue(record);
  record.needsRecovery = needsRecovery(record);
}

export function acceptedWork(
  result: SmsSendResult,
  summary: SubmissionSummary,
): DeliveryWork | undefined {
  if (result.outcome !== 'accepted') return;
  const available = !!result.providerMessageId && !!result.deviceId;
  const acceptedAt = summary.updatedAt;
  summary.delivery = {
    status: 'pending',
    observedAt: null,
    acceptedAt,
    expiresAt: new Date(Date.parse(acceptedAt) + SOS_DELIVERY_TRACK_TIMEOUT_MS).toISOString(),
    tracking: available ? 'active' : 'unavailable',
    lastAttemptAt: null,
    lastCheckedAt: null,
    lastCheckError: available ? null : 'not_configured',
    failureCode: null,
  };
  if (available)
    return {
      providerMessageId: result.providerMessageId!,
      deviceId: result.deviceId!,
      dueAt: Date.parse(acceptedAt),
      revision: 0,
      leaseUntil: 0,
      failures: 0,
    };
}

export function finishRefresh(record: SosRecord, now: number): void {
  if (record.statusRefresh?.state !== 'pending') return;
  const targets = record.refreshTargets ?? [];
  if (Date.parse(record.statusRefresh.expiresAt!) <= now) {
    for (const target of targets) if (target.result === 'pending') target.result = 'error';
  }
  if (targets.some((t) => t.result === 'pending')) return;
  const ok = targets.filter((t) => t.result === 'ok').length;
  record.statusRefresh.state =
    ok === targets.length && ok > 0 ? 'complete' : ok > 0 ? 'partial' : 'unavailable';
}

// One indexed scalar per SOS. No frequent historical collection scans.
export function updateDeliveryDue(record: SosRecord): void {
  const due: number[] = [];
  const refresh = record.statusRefresh?.state === 'pending';
  if (refresh) due.push(Date.parse(record.statusRefresh!.expiresAt!));
  for (const recipient of record.recipients)
    for (const which of messageKinds) {
      const summary = recipient[which];
      const work = workFor(recipient, which);
      if (!work || !summary?.delivery || terminal(summary)) continue;
      const target =
        refresh &&
        record.refreshTargets?.some(
          (t) => t.contactId === recipient.contactId && t.which === which && t.result === 'pending',
        );
      if (summary.delivery.tracking === 'active' || target) {
        const next = Math.max(work.dueAt, work.leaseUntil);
        due.push(
          summary.delivery.tracking === 'active'
            ? Math.min(next, Date.parse(summary.delivery.expiresAt))
            : next,
        );
      }
    }
  record.deliveryDueAt = due.length ? Math.min(...due) : null;
}

export function applyLookup(
  summary: SubmissionSummary,
  work: DeliveryWork,
  result: SmsDeliveryStatus,
  now: number,
): void {
  const d = summary.delivery!;
  if (terminal(summary)) return;
  const iso = new Date(now).toISOString();
  const recognized = result.state !== 'unknown' || result.reason === 'provider_unknown';
  if (recognized) {
    d.lastCheckedAt = iso;
    d.lastCheckError = result.state === 'unknown' ? 'provider_unknown' : null;
    work.failures = 0;
    const next = result.state;
    if (next !== d.status && !(d.status === 'sent' && (next === 'unknown' || next === 'pending'))) {
      d.status = next;
      d.observedAt = iso;
    } else if (!d.observedAt && next === d.status) d.observedAt = iso;
    if (result.state === 'failed') d.failureCode = result.errorCode ?? null;
  } else {
    d.lastCheckError = result.reason;
    work.failures++;
  }
  const permanent =
    result.state === 'unknown' &&
    ['authentication_failed', 'not_configured', 'not_found'].includes(result.reason);
  d.tracking = terminal(summary)
    ? 'complete'
    : permanent
      ? 'unavailable'
      : now >= Date.parse(d.expiresAt)
        ? 'timed_out'
        : 'active';
  const normal = Date.parse(d.lastAttemptAt!) - Date.parse(d.acceptedAt) < 60000 ? 5000 : 15000;
  const backoff = work.failures ? Math.min(60000, 10000 * 2 ** (work.failures - 1)) : 0;
  work.dueAt =
    Date.parse(d.lastAttemptAt!) +
    Math.max(
      normal,
      backoff,
      result.state === 'unknown' && result.reason === 'rate_limited'
        ? (result.retryAfterMs ?? 60000)
        : 0,
    );
  work.leaseUntil = 0;
}
