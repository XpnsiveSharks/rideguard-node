import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { DeviceType } from './device.entity';
import { DeviceId } from './device-id.value-object';

describe('DeviceId', () => {
  it('generates camera device IDs with the CAM-123-ABC format', () => {
    const deviceId = DeviceId.generate(DeviceType.CAMERA);

    expect(deviceId).toMatch(/^CAM-\d{3}-[A-Z]{3}$/);
  });

  it('generates metal detector device IDs with the MET-123-ABC format', () => {
    const deviceId = DeviceId.generate(DeviceType.METAL_DETECTOR);

    expect(deviceId).toMatch(/^MET-\d{3}-[A-Z]{3}$/);
  });

  it('accepts device IDs when the prefix matches the device type', () => {
    const deviceId = DeviceId.create('CAM-793-MAU', DeviceType.CAMERA);

    expect(deviceId.toString()).toBe('CAM-793-MAU');
  });

  it('rejects device IDs when the prefix does not match the device type', () => {
    expect(() => DeviceId.create('MET-793-MAU', DeviceType.CAMERA)).toThrow(BadRequestException);
  });

  it('rejects device IDs with the old ABC-123 format', () => {
    expect(() => DeviceId.create('ABC-123')).toThrow(BadRequestException);
  });
});
