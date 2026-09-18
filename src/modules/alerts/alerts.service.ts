import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { Alert } from './domain/alerts.entity';

@Injectable()
export class AlertsService {
  constructor(private readonly alertsRepository: AlertsRepository) {}

  async createAlert(alert: Alert): Promise<void> {
    await this.alertsRepository.save(alert);
  }
}
