export type InferenceResult = {
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
  image: InferenceImage;
};

export type InferenceImage = {
  status: string;
  provider: string;
  url: string;
  public_id: string;
  format: string;
  width: number;
  height: number;
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
  status: string;
  label: string | null;
  confidence: number | null;
};
