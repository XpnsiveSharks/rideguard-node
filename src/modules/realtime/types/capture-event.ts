// Published by the model-api on the rideguard-capture-images channel during a
// START_CAPTURE session. One capture.image per uploaded frame; one
// capture.skipped when a press produced no frames.

export type CaptureImageEvent = {
  schema_version: 1;
  capture_id: string;
  event_id: string;
  button_id: string;
  camera_id: string;
  captured_at: string;
  sequence: number;
  image: {
    status: 'uploaded';
    provider: 'cloudinary';
    url: string;
    public_id: string;
    format: string;
    width: number;
    height: number;
  };
};

export type CaptureSkippedStatus = 'no_camera_registered' | 'service_unavailable';

export type CaptureSkippedEvent = {
  schema_version: 1;
  capture_id: string;
  button_id: string;
  status: CaptureSkippedStatus;
  occurred_at: string;
};
