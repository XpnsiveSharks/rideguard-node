import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { DevicesService } from '@/modules/devices/devices.service';
import { AlertsRepository } from '@/modules/alerts/infrastructure/alerts.repository';
import { SettingsService } from './settings.service';

const INTERVAL_MS = 60 * 1000; // every 60 seconds

// Max alerts archived per account per pass. Bounds each pass so one large
// account cannot starve the others; archived alerts leave the candidate query,
// so the next pass resumes with whatever remains.
const MAX_ALERTS_PER_ACCOUNT_PER_PASS = 500;

@Injectable()
export class AutoArchiveProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoArchiveProcessorService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly alertsRepository: AlertsRepository,
    private readonly devicesService: DevicesService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    // Disabled by default; enabled only after the field backfill and index
    // verification described in the implementation plan (§9).
    if (!this.configService.get('AUTO_ARCHIVE_ENABLED', { infer: true })) {
      this.logger.log('Auto-archive processor is disabled (AUTO_ARCHIVE_ENABLED=false).');
      return;
    }

    // Run immediately on startup, then every INTERVAL_MS.
    void this.run();
    this.intervalHandle = setInterval(() => void this.run(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async run(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Auto-archive run skipped — previous run still in progress.');
      return;
    }

    this.isProcessing = true;
    try {
      const profiles = await this.settingsService.getEnabledProfiles();
      if (profiles.length === 0) return;

      let totalArchived = 0;

      for (const { uid, autoArchiveHours } of profiles) {
        try {
          const deviceIds = await this.devicesService.findDeviceIdsByAssignedUser(uid);
          if (deviceIds.length === 0) continue;

          // Fresh `now` per account; the repository re-reads the preference and
          // ownership inside each per-alert transaction before archiving.
          const { archived } = await this.alertsRepository.archiveDueAlerts({
            uid,
            deviceIds,
            autoArchiveHours,
            now: new Date(),
            limit: MAX_ALERTS_PER_ACCOUNT_PER_PASS,
          });
          totalArchived += archived;
        } catch (err) {
          this.logger.error(`Auto-archive failed for uid=${uid}: ${(err as Error).message}`);
        }
      }

      if (totalArchived > 0) {
        this.logger.log(`Auto-archive run complete: archived ${totalArchived} alert(s).`);
      }
    } catch (err) {
      this.logger.error(`Auto-archive run failed: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
