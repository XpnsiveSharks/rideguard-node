import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { Alert, AlertFields } from './domain/alerts.entity';
import { ALERT_EVENTS } from './alerts.constants';
import { PinoLogger } from 'nestjs-pino';
import { DevicesService } from '../devices/devices.service';
@Injectable()
export class AlertsService {
  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly logger: PinoLogger,
    private readonly diviceService: DevicesService,
  ) {}

  // *** CREATE ALERT - REALTIME INFERENCE ***
  async createAlert(alert: AlertFields): Promise<Alert> {
    const newAlert = Alert.create(alert);
    await this.alertsRepository.save(newAlert);

    this.logger.info(
      { event: ALERT_EVENTS.ALERT_CREATED },
      `Alert created: ${JSON.stringify(newAlert)}`,
    );

    return newAlert;
  }

  // *** GET ALERTS BY ASSIGNED USER ID - USER ***
  async getAlertsByAssignedUserId(
    assignedUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: Alert[]; nextCursor: string | null }> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);

    return await this.alertsRepository.findNonFalseAlarmsByDeviceId(deviceIds, limit, cursor);
  }
}
