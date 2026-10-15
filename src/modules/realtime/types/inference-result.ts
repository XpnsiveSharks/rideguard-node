export type InferenceResult = {
  schema_version?: 2;
  event_id: string;
  device_id: string;
  captured_at: string;
  pose: {
    person_count: number;
  };
  detections: {
    objects: DetectedObject[];
  };
  violence: ViolenceResult;
  image: InferenceImage | null;
  // Absent or null means no clip, including from older producers. Only ever
  // present on a fresh, alert-eligible violence result.
  video?: InferenceVideo | null;
};

export type InferenceImage =
  | {
      status: 'uploaded';
      provider: 'cloudinary';
      url: string;
      public_id: string;
      format: string;
      width: number;
      height: number;
    }
  | {
      status: 'upload_failed';
      provider: 'cloudinary';
      url: null;
    };

export type InferenceVideo =
  | {
      status: 'uploaded';
      provider: 'cloudinary';
      public_id: string;
      format: string;
      url: string;
      frame_count: number;
      started_at: string;
      ended_at: string;
    }
  | {
      // Covers encoding failure, upload failure, or insufficient processing budget.
      status: 'unavailable';
      url: null;
    };

export type DetectedObject = {
  label: string;
  confidence: number;
  box: BoundingBox;
};

export type BoundingBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ViolenceResult = {
  // Version 2 carries the producer's confidence decision with the raw result.
  alert_eligible?: boolean;
  status: string;
  label: string | null;
  confidence: number | null;
  inference_ran: boolean;
};
