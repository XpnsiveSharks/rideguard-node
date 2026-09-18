import { Alert } from '../domain/alerts.entity';
import { AlertFields } from '../domain/alerts.entity';

export const ALERTS_COLLECTION = 'alerts';

export class AlertsMapper {
  static toPersistence(alert: Alert): AlertFields {
    return {
      deviceId: alert.alertFields.deviceId.toString(),
      message: alert.getMessage(),
      imageUrl: alert.getImageUrl(),
      timeStamp: alert.getTimeStamp(),
      isFalseAlarm: alert.getIsFalseAlarm(),
      isSeen: alert.getIsSeen(),
    };
  }

  static toDomain(alertsFields: AlertFields): Alert {
    return Alert.create(alertsFields);
  }
}
