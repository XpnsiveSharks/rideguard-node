import { SMS_MAX_MESSAGE_LENGTH } from '@/infra/sms/sms.constants';
import { SOS_MAX_NAME_LENGTH, SOS_TIME_ZONE } from './sos.constants';
import type { SosLocation } from './sos.types';

const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: SOS_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatTime(date: Date): string {
  return `${timeFormat.format(date)} PHT`;
}

function boundedName(name: string, limit: number): string {
  const trimmed = name.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, Math.max(limit - 1, 1))}.`;
}

export type ComposedMessage = { text: string; locationOmitted: boolean };

// Initial SOS text. Contacts with email receive the map link there; SMS only
// directs them to email so carriers do not filter the URL.
export function composeInitialMessage(
  requesterName: string,
  location: SosLocation | null,
  emailAvailable = true,
): ComposedMessage | null {
  const fitting = (text: string): boolean => text.length <= SMS_MAX_MESSAGE_LENGTH;

  if (!emailAvailable) {
    if (location) {
      const url = `https://maps.google.com/?q=${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
      const at = formatTime(new Date(location.capturedAt));
      for (let limit = SOS_MAX_NAME_LENGTH; limit >= 8; limit -= 4) {
        const text = `RideGuard SOS: ${boundedName(requesterName, limit)} needs help. Phone location as of ${at}: ${url}`;
        if (fitting(text)) return { text, locationOmitted: false };
      }
    }
    const legacyText = `RideGuard SOS: ${boundedName(requesterName, SOS_MAX_NAME_LENGTH)} needs help. Location unavailable.`;
    return fitting(legacyText) ? { text: legacyText, locationOmitted: location !== null } : null;
  }

  if (location) {
    for (let limit = SOS_MAX_NAME_LENGTH; limit >= 8; limit -= 4) {
      const text = `RideGuard SOS: ${boundedName(requesterName, limit)} needs help. ${emailAvailable ? 'Check your email for the map link.' : 'Contact someone directly.'}`;
      if (fitting(text)) {
        return { text, locationOmitted: Boolean(location) };
      }
    }
  }

  const text = `RideGuard SOS: ${boundedName(requesterName, SOS_MAX_NAME_LENGTH)} needs help. ${
    emailAvailable && location ? 'Check your email for the map link.' : 'Location unavailable.'
  }`;
  return fitting(text) ? { text, locationOmitted: location !== null } : null;
}

// End-of-SOS text. Deliberately does not claim the user is safe.
export function composeEndMessage(requesterName: string, endedAt: Date): string | null {
  const text = `RideGuard: SOS ended by ${boundedName(requesterName, SOS_MAX_NAME_LENGTH)} at ${formatTime(endedAt)}.`;
  return text.length <= SMS_MAX_MESSAGE_LENGTH ? text : null;
}
