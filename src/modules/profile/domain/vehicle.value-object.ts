import { BadRequestException } from '@nestjs/common';

export class Vehicle {
  private constructor(public vehicleInfoFields: VehicleInfoFields) {}

  static create(vehicleInfo: VehicleInfoFields): Vehicle {
    const trimmedVehicle = vehicleInfo.vehicleName.trim();
    if (!trimmedVehicle) {
      throw new BadRequestException('Vehicle is required');
    }

    const trimmedPlateNumber = vehicleInfo.plateNumber.trim();
    if (!trimmedPlateNumber) {
      throw new BadRequestException('Plate number is required');
    }

    return new Vehicle({
      vehicleName: vehicleInfo.vehicleName,
      plateNumber: vehicleInfo.plateNumber,
      color: !vehicleInfo.color ? 'not set' : vehicleInfo.color,
    });
  }
}

export type VehicleInfoFields = {
  vehicleName: string;
  plateNumber: string;
  color?: string;
};
