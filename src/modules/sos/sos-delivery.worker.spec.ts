import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { EnvironmentVariables } from '@/config/env.validation';
import { SmsDeliveryTracker } from '@/infra/sms/sms-delivery-tracker';
import { SosRepository } from './infrastructure/sos.repository';
import { SosDeliveryWorker } from './sos-delivery.worker';
import type { SosRecord } from './sos.types';

describe('SOS delivery worker diagnostics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function setup(records: SosRecord[] = []) {
    const repository = {
      listDeliveryDue: jest.fn<Promise<SosRecord[]>, [number]>().mockResolvedValue(records),
    } satisfies Pick<SosRepository, 'listDeliveryDue'>;
    const tracker = { check: jest.fn() } satisfies Pick<SmsDeliveryTracker, 'check'>;
    const module = await Test.createTestingModule({
      providers: [
        SosDeliveryWorker,
        { provide: SosRepository, useValue: repository },
        { provide: SmsDeliveryTracker, useValue: tracker },
        { provide: ConfigService, useValue: new ConfigService<EnvironmentVariables, true>() },
      ],
    }).compile();
    return { module, repository, tracker, worker: module.get(SosDeliveryWorker) };
  }

  it('reports lifecycle startup and a successful query, without repeatedly logging empty polls', async () => {
    const h = await setup();
    try {
      await h.module.init();
      await jest.advanceTimersByTimeAsync(3000);
      expect(h.repository.listDeliveryDue).toHaveBeenCalledTimes(4);
      expect(Logger.prototype.log).toHaveBeenCalledWith('SOS delivery worker started');
      expect(Logger.prototype.log).toHaveBeenCalledWith({ message: 'SOS delivery query ready', dueCount: 0 });
      expect(jest.mocked(Logger.prototype.log).mock.calls.filter(
        ([value]) => value?.message === 'SOS delivery query ready',
      )).toHaveLength(1);
      expect(h.tracker.check).not.toHaveBeenCalled();
    } finally { await h.module.close(); }
    const count = h.repository.listDeliveryDue.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.repository.listDeliveryDue).toHaveBeenCalledTimes(count);
  });

  it('reports a stuck database query once a minute without overlapping queries', async () => {
    const h = await setup();
    let release!: (records: SosRecord[]) => void;
    h.repository.listDeliveryDue.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    try {
      await h.module.init();
      await jest.advanceTimersByTimeAsync(119000);
      expect(h.repository.listDeliveryDue).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.warn).toHaveBeenCalledWith({
        message: 'SOS delivery scheduling is still waiting', stage: 'query', elapsedMs: 60000,
      });
      release([]);
      await jest.advanceTimersByTimeAsync(1000);
      expect(h.repository.listDeliveryDue).toHaveBeenCalledTimes(2);
    } finally { await h.module.close(); }
  });

  it('logs the database error code without the raw error and retries scheduling', async () => {
    const h = await setup();
    const error = Object.assign(new Error('private provider URL or message'), { code: 7 });
    h.repository.listDeliveryDue.mockRejectedValueOnce(error);
    try {
      await h.module.init();
      await jest.advanceTimersByTimeAsync(1000);
      expect(Logger.prototype.warn).toHaveBeenCalledWith({
        message: 'SOS delivery scheduling failed', stage: 'query', code: 7,
      });
      expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain(error.message);
      expect(h.repository.listDeliveryDue).toHaveBeenCalledTimes(2);
    } finally { await h.module.close(); }
  });

  it('does not leak unexpected error-code contents', async () => {
    const h = await setup();
    h.repository.listDeliveryDue.mockRejectedValueOnce({ code: 'https://private.example/token' });
    try {
      await h.worker.tick();
      expect(Logger.prototype.warn).toHaveBeenCalledWith({
        message: 'SOS delivery scheduling failed', stage: 'query', code: 'unknown',
      });
    } finally { await h.module.close(); }
  });
});
