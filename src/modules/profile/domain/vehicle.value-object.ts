import { BadRequestException } from '@nestjs/common';

export class Vehicle {
  private constructor(public readonly vehicleInfo: VehicleInfo) {}

  static create(vehicleInfo: VehicleInfo): Vehicle {
    const trimmedVehicle = vehicleInfo.vehicleName.trim();
    const trimmedPlateNumber = vehicleInfo.plateNumber.trim();

    if (!trimmedVehicle) {
      throw new BadRequestException('Vehicle is required');
    }

    if (!trimmedPlateNumber) {
      throw new BadRequestException('Plate number is required');
    }

    return new Vehicle(vehicleInfo);
  }
}

type VehicleInfo = {
  vehicleName: string;
  plateNumber: string;
};
