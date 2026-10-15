import * as Joi from 'joi';
import { ButtonEventData, ButtonEventName } from '../types/button-event.types';

// Fields every button event carries.
const commonFields = {
  event_id: Joi.string().guid({ version: 'uuidv4' }).required(),

  device_id: Joi.string()
    .pattern(/^BUT-\d{3}-[A-Z]{3}$/)
    .required(),

  occurred_at: Joi.string().isoDate().required(),
};

// A short press that triggers a capture or alert action. The current firmware
// omits schema_version here, and press_id is only present for an SOS press.
const buttonPressedSchema = Joi.object<ButtonEventData>({
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
  .unknown(false);

// Start of an SOS hold.
const buttonPressStartedSchema = Joi.object<ButtonEventData>({
  ...commonFields,

  schema_version: Joi.number().valid(1).required(),

  press_id: Joi.string().guid({ version: 'uuidv4' }).required(),

  button: Joi.string().valid('SOS').required(),
})
  .required()
  .unknown(false);

// End of an SOS hold, with how long the button was held.
const buttonPressReleasedSchema = Joi.object<ButtonEventData>({
  ...commonFields,

  schema_version: Joi.number().valid(1).required(),

  press_id: Joi.string().guid({ version: 'uuidv4' }).required(),

  button: Joi.string().valid('SOS').required(),

  held_ms: Joi.number().integer().min(0).max(0xffffffff).required(),
})
  .required()
  .unknown(false);

export const buttonEventSchemas: Record<ButtonEventName, Joi.ObjectSchema<ButtonEventData>> = {
  'button.pressed': buttonPressedSchema,
  'button.press_started': buttonPressStartedSchema,
  'button.press_released': buttonPressReleasedSchema,
};
