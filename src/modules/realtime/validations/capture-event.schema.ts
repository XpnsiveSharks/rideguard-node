import * as Joi from 'joi';
import type { CaptureImageEvent, CaptureSkippedEvent } from '../types/capture-event';

const BUTTON_ID_PATTERN = /^BUT-\d{3}-[A-Z]{3}$/;
const CAMERA_ID_PATTERN = /^CAM-\d{3}-[A-Z]{3}$/;

// Only the uploaded shape: the model-api skips publishing a frame whose upload
// failed, so a capture.image always carries a real URL.
const uploadedImageSchema = Joi.object({
  status: Joi.string().valid('uploaded').required(),
  provider: Joi.string().valid('cloudinary').required(),

  url: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),

  public_id: Joi.string().trim().required(),

  format: Joi.string().valid('jpg', 'jpeg', 'png').required(),

  width: Joi.number().integer().positive().required(),
  height: Joi.number().integer().positive().required(),
})
  .required()
  .unknown(false);

export const captureImageSchema = Joi.object<CaptureImageEvent>({
  schema_version: Joi.number().valid(1).required(),
  capture_id: Joi.string().trim().required(),
  event_id: Joi.string().trim().required(),

  button_id: Joi.string().pattern(BUTTON_ID_PATTERN).required(),
  camera_id: Joi.string().pattern(CAMERA_ID_PATTERN).required(),

  captured_at: Joi.string().isoDate().required(),
  sequence: Joi.number().integer().positive().required(),

  image: uploadedImageSchema,
})
  .required()
  .unknown(false);

export const captureSkippedSchema = Joi.object<CaptureSkippedEvent>({
  schema_version: Joi.number().valid(1).required(),
  capture_id: Joi.string().trim().required(),

  button_id: Joi.string().pattern(BUTTON_ID_PATTERN).required(),

  status: Joi.string().valid('no_camera_registered', 'service_unavailable').required(),

  occurred_at: Joi.string().isoDate().required(),
})
  .required()
  .unknown(false);
