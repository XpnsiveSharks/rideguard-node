export class Vehicle {
  private constructor(
    public readonly vehicle: string,
    public readonly plateNumber: string,
  ) {}

  static create(vehicle: string, plateNumber: string): Vehicle {
    const trimmedVehicle = vehicle.trim();
    const trimmedPlateNumber = plateNumber.trim();

    if (!trimmedVehicle) {
      throw new Error('Vehicle is required');
    }

    if (!trimmedPlateNumber) {
      throw new Error('Plate number is required');
    }

    return new Vehicle(trimmedVehicle, trimmedPlateNumber);
  }
}
