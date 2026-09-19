import * as Joi from 'joi';
import type {
  BoundingBox,
  DetectedObject,
  InferenceImage,
  InferenceResult,
  ViolenceResult,
} from './realtime-result';

const boundingBoxSchema = Joi.object<BoundingBox>({
  x1: Joi.number().min(0).required(),
  y1: Joi.number().min(0).required(),

  x2: Joi.number().greater(Joi.ref('x1')).required(),

  y2: Joi.number().greater(Joi.ref('y1')).required(),
})
  .required()
  .unknown(false);

const detectedObjectSchema = Joi.object<DetectedObject>({
  label: Joi.string().trim().required(),

  confidence: Joi.number().min(0).max(1).required(),

  box: boundingBoxSchema,
}).unknown(false);

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
}).unknown(false);

const failedImageSchema = Joi.object({
  status: Joi.string().valid('upload_failed').required(),
  provider: Joi.string().valid('cloudinary').required(),
  url: Joi.any().valid(null).required(),
}).unknown(false);

const inferenceImageSchema = Joi.alternatives<InferenceImage>().try(
  uploadedImageSchema,
  failedImageSchema,
);

const violenceResultSchema = Joi.object<ViolenceResult>({
  inference_ran: Joi.boolean().required(),
  status: Joi.string().trim().required(),
  label: Joi.string().trim().allow(null).required(),
  confidence: Joi.number().min(0).max(1).allow(null).required(),
})
  .required()
  .unknown(false);

export const inferenceResultSchema = Joi.object<InferenceResult>({
  event_id: Joi.string().trim().required(),
  device_id: Joi.string().trim().required(),
  captured_at: Joi.string().isoDate().required(),

  pose: Joi.object({
    person_count: Joi.number().integer().min(0).required(),
  })
    .required()
    .unknown(false),

  detections: Joi.object({
    objects: Joi.array().items(detectedObjectSchema).required(),
  })
    .required()
    .unknown(false),

  violence: violenceResultSchema,
  image: inferenceImageSchema.allow(null).required(),
})
  .required()
  .unknown(false);
