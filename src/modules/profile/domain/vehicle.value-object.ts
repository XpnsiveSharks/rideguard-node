import { BadRequestException } from '@nestjs/common';

export class Vehicle {
  private constructor(public vehicleInfoFields: VehicleInfoFields) {}

  static create(vehicleInfo: VehicleInfoFields): Vehicle {
    const trimmedBrand = vehicleInfo.brand.trim();
    if (!trimmedBrand) {
      throw new BadRequestException('Brand is required');
    }

    const trimmedModel = vehicleInfo.model.trim();
    if (!trimmedModel) {
      throw new BadRequestException('Model is required');
    }

    const trimmedColor = vehicleInfo.color?.trim();
    if (!trimmedColor) {
      throw new BadRequestException('Color is required');
    }

    const trimmedPlateNumber = vehicleInfo.plateNumber.trim();
    if (!trimmedPlateNumber) {
      throw new BadRequestException('Plate number is required');
    }

    return new Vehicle({
      brand: trimmedBrand,
      model: trimmedModel,
      plateNumber: trimmedPlateNumber,
      color: trimmedColor,
    });
  }
}

export type VehicleInfoFields = {
  brand: string;
  model: string;
  plateNumber: string;
  color: string;
};
