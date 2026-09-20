import { trimmed } from '@/common/helpers/trimmed';
import { BadRequestException } from '@nestjs/common';

export class Alert {
  constructor(public readonly alertFields: AlertFields) {}

  public static create(alertFields: AlertFields): Alert {
    const { deviceId, message, imageUrl, timeStamp, isFalseAlarm, isSeen } = alertFields;
    const trimmedMessage = trimmed(message, 'message');

    return new Alert({
      alertId: alertFields.alertId,
      deviceId: deviceId,
      message: trimmedMessage,
      imageUrl: imageUrl,
      timeStamp,
      isFalseAlarm,
      isSeen,
    });
  }

  getMessage(): string {
    if (!this.alertFields.message) throw new BadRequestException('Message field is required');
    return this.alertFields.message;
  }

  getImageUrl(): string | null | undefined {
    return this.alertFields.imageUrl;
  }

  getTimeStamp(): Date {
    if (!this.alertFields.timeStamp) throw new BadRequestException('Timestamp field is required');
    return this.alertFields.timeStamp;
  }

  getIsFalseAlarm(): boolean {
    return this.alertFields.isFalseAlarm;
  }

  getIsSeen(): boolean {
    return this.alertFields.isSeen;
  }
}

export type AlertFields = {
  alertId?: string;
  deviceId: string;
  message: string;
  imageUrl?: string | null | undefined;
  timeStamp: Date;
  isFalseAlarm: boolean;
  isSeen: boolean;
};
