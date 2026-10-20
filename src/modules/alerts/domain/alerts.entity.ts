import { trimmed } from '@/common/helpers/trimmed';
import { BadRequestException } from '@nestjs/common';

export class Alert {
  constructor(public readonly alertFields: AlertFields) {}

  public static create(alertFields: AlertFields): Alert {
    const {
      deviceId,
      message,
      imageUrl,
      videoUrl,
      timeStamp,
      isFalseAlarm,
      isSeen,
      createdAt,
      isArchived,
      archivedAt,
      archiveAt,
    } = alertFields;
    const trimmedMessage = trimmed(message, 'message');

    return new Alert({
      alertId: alertFields.alertId,
      deviceId: deviceId,
      message: trimmedMessage,
      imageUrl: imageUrl,
      // A record saved before this field existed has no key at all; normalize
      // that to null rather than leaking undefined to clients.
      videoUrl: videoUrl ?? null,
      timeStamp,
      createdAt: createdAt ?? timeStamp,
      isFalseAlarm,
      isSeen,
      isArchived: isArchived ?? false,
      archivedAt: archivedAt ?? null,
      archiveAt: archiveAt ?? null,
    });
  }

  getMessage(): string {
    if (!this.alertFields.message) throw new BadRequestException('Message field is required');
    return this.alertFields.message;
  }

  getImageUrl(): string | null | undefined {
    return this.alertFields.imageUrl;
  }

  getVideoUrl(): string | null {
    return this.alertFields.videoUrl ?? null;
  }

  getTimeStamp(): Date {
    if (!this.alertFields.timeStamp) throw new BadRequestException('Timestamp field is required');
    return this.alertFields.timeStamp;
  }

  getCreatedAt(): Date {
    return this.alertFields.createdAt ?? this.getTimeStamp();
  }

  getIsFalseAlarm(): boolean {
    return this.alertFields.isFalseAlarm;
  }

  getIsSeen(): boolean {
    return this.alertFields.isSeen;
  }

  getIsArchived(): boolean {
    return this.alertFields.isArchived ?? false;
  }

  getArchivedAt(): Date | null {
    return this.alertFields.archivedAt ?? null;
  }

  getArchiveAt(): Date | null {
    return this.alertFields.archiveAt ?? null;
  }
}

export type AlertFields = {
  alertId?: string;
  deviceId: string;
  message: string;
  imageUrl?: string | null | undefined;
  videoUrl?: string | null | undefined;
  timeStamp: Date;
  createdAt?: Date;
  isFalseAlarm: boolean;
  isSeen: boolean;
  isArchived?: boolean;
  archivedAt?: Date | null;
  archiveAt?: Date | null;
};
