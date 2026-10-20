import { Alert } from '../domain/alerts.entity';
import { AlertFields } from '../domain/alerts.entity';

export const ALERTS_COLLECTION = 'alerts';

export class AlertsMapper {
  static toPersistence(alert: Alert): AlertFields {
    return {
      deviceId: alert.alertFields.deviceId.toString(),
      message: alert.getMessage(),
      imageUrl: alert.getImageUrl(),
      videoUrl: alert.getVideoUrl(),
      timeStamp: alert.getTimeStamp(),
      createdAt: alert.getCreatedAt(),
      isFalseAlarm: alert.getIsFalseAlarm(),
      isSeen: alert.getIsSeen(),
      isArchived: alert.getIsArchived(),
      archivedAt: alert.getArchivedAt(),
    };
  }

  static toDomain(alertId: string, alertsFields: AlertFields | Record<string, any>): Alert {
    const toDate = (val: unknown): Date | undefined => {
      if (!val) return undefined;
      if (val instanceof Date) return val;
      if (typeof (val as any).toDate === 'function') return (val as any).toDate();
      const d = new Date(val as string | number);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const timeStamp = toDate(alertsFields.timeStamp) ?? new Date();
    const createdAt = toDate(alertsFields.createdAt) ?? timeStamp;
    const archivedAt = toDate(alertsFields.archivedAt) ?? null;
    const archiveAt = toDate(alertsFields.archiveAt) ?? null;

    return Alert.create({
      ...alertsFields,
      alertId,
      deviceId: String(alertsFields.deviceId),
      message: String(alertsFields.message),
      imageUrl: alertsFields.imageUrl,
      videoUrl: alertsFields.videoUrl,
      timeStamp,
      createdAt,
      isFalseAlarm: Boolean(alertsFields.isFalseAlarm),
      isSeen: Boolean(alertsFields.isSeen),
      isArchived: Boolean(alertsFields.isArchived),
      archivedAt,
      archiveAt,
    });
  }
}
