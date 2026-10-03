import * as Joi from 'joi';

export const BUTTON_EVENT_NAMES = [
  'button.pressed',
  'button.press_started',
  'button.press_released',
] as const;

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

const commonFields = {
  event_id: Joi.string().guid({ version: 'uuidv4' }).required(),
  device_id: Joi.string()
    .pattern(/^BUT-\d{3}-[A-Z]{3}$/)
    .required(),
  occurred_at: Joi.string().isoDate().required(),
};

// The current firmware omits schema_version on button.pressed, while the
// press/release lifecycle messages explicitly use version 1.
const schemas: Record<ButtonEventName, Joi.ObjectSchema<ButtonEventData>> = {
  'button.pressed': Joi.object<ButtonEventData>({
    ...commonFields,
    schema_version: Joi.number().valid(1),
    press_type: Joi.string()
      .valid('START_CAPTURE', 'STOP_CAPTURE', 'FALSE_ALARM', 'SOS', 'CANCEL_SOS')
      .required(),
    press_id: Joi.when('press_type', {
      is: 'SOS',
      then: Joi.string().guid({ version: 'uuidv4' }).required(),
      otherwise: Joi.forbidden(),
    }),
  })
    .required()
    .unknown(false),
  'button.press_started': Joi.object<ButtonEventData>({
    ...commonFields,
    schema_version: Joi.number().valid(1).required(),
    press_id: Joi.string().guid({ version: 'uuidv4' }).required(),
    button: Joi.string().valid('SOS').required(),
  })
    .required()
    .unknown(false),
  'button.press_released': Joi.object<ButtonEventData>({
    ...commonFields,
    schema_version: Joi.number().valid(1).required(),
    press_id: Joi.string().guid({ version: 'uuidv4' }).required(),
    button: Joi.string().valid('SOS').required(),
    held_ms: Joi.number().integer().min(0).max(0xffffffff).required(),
  })
    .required()
    .unknown(false),
};

export function parseButtonEvent(name: string | undefined, data: unknown): ButtonEventData | null {
  if (!BUTTON_EVENT_NAMES.some((eventName) => eventName === name)) return null;

  const result = schemas[name as ButtonEventName].validate(data, { convert: false });
  return result.error ? null : result.value;
}
