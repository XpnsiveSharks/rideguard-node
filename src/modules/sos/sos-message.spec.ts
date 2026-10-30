import { SMS_MAX_MESSAGE_LENGTH } from '@/infra/sms/sms.constants';
import { composeEndMessage, composeInitialMessage } from './sos-message';
import type { SosLocation } from './sos.types';

const location: SosLocation = {
  latitude: 14.5995,
  longitude: 120.9842,
  capturedAt: '2026-10-23T07:45:00.000Z', // 3:45 pm in Manila
  accuracyMeters: 10,
};

describe('composeInitialMessage', () => {
  it('directs the contact to email without putting a URL in SMS', () => {
    const message = composeInitialMessage('Maria Santos', location);

    expect(message?.locationOmitted).toBe(true);
    expect(message?.text).toContain('Maria Santos');
    expect(message?.text).toContain('Check your email for the map link.');
    expect(message?.text).not.toContain('http');
    expect(message?.text.length).toBeLessThanOrEqual(SMS_MAX_MESSAGE_LENGTH);
  });

  it('says location is unavailable when there is none', () => {
    const message = composeInitialMessage('Maria Santos', null);

    expect(message).toEqual({
      text: 'RideGuard SOS: Maria Santos needs help. Location unavailable.',
      locationOmitted: false,
    });
  });

  it('keeps the email instruction within one segment for a long name', () => {
    const message = composeInitialMessage('A'.repeat(80), location);

    expect(message?.locationOmitted).toBe(true);
    expect(message?.text).toContain('Check your email for the map link.');
    expect(message?.text.length).toBeLessThanOrEqual(SMS_MAX_MESSAGE_LENGTH);
  });

  it('never claims live tracking', () => {
    const text = composeInitialMessage('Maria', location)?.text ?? '';
    expect(text.toLowerCase()).not.toContain('live');
    expect(text.toLowerCase()).not.toContain('tracking');
  });
});

describe('composeEndMessage', () => {
  it('says the SOS ended by the user and does not claim safety', () => {
    const text = composeEndMessage('Maria Santos', new Date('2026-10-23T08:00:00.000Z'));

    expect(text).toMatch(/SOS ended by Maria Santos at 4:00\s?pm PHT/i);
    expect(text?.toLowerCase()).not.toContain('safe');
  });

  it('stays within one segment for a very long name', () => {
    const text = composeEndMessage('B'.repeat(200), new Date());
    expect(text?.length).toBeLessThanOrEqual(SMS_MAX_MESSAGE_LENGTH);
  });
});
