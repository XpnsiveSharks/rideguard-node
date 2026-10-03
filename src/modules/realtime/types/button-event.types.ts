import { BUTTON_EVENT_NAMES } from '../realtime.constants';

export type ButtonEventName = (typeof BUTTON_EVENT_NAMES)[number];
export type ButtonAction = 'START_CAPTURE' | 'STOP_CAPTURE' | 'FALSE_ALARM' | 'SOS' | 'CANCEL_SOS';

export interface ButtonEventData {
  event_id: string;
  device_id: string;
  occurred_at: string;
  schema_version?: 1;
  press_type?: ButtonAction;
  press_id?: string;
  button?: 'SOS';
  held_ms?: number;
}
