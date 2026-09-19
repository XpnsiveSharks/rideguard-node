import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { Alert, AlertFields } from './domain/alerts.entity';
import { ALERT_EVENTS } from './alerts.constants';
import { PinoLogger } from 'nestjs-pino';
@Injectable()
export class AlertsService {
  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly logger: PinoLogger,
  ) {}

  async createAlert(alert: AlertFields): Promise<Alert> {
    const newAlert = Alert.create(alert);
    await this.alertsRepository.save(newAlert);

    this.logger.info(
      { event: ALERT_EVENTS.ALERT_CREATED },
      `Alert created: ${JSON.stringify(newAlert)}`,
    );

    return newAlert;
  }
}
