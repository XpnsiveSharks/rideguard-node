import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';

const DEVICE_ID_PREFIX_LETTER_COUNT = 3;
const DEVICE_ID_LETTER_COUNT = 3;
const DEVICE_ID_NUMBER_COUNT = 3;
const DEVICE_ID_SEPARATOR = '-';
const DEVICE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const MIN_NUMBER_PART = 0;
const MAX_NUMBER_PART = 10 ** DEVICE_ID_NUMBER_COUNT;
const DEVICE_ID_PATTERN = new RegExp(
  `^[A-Z]{${DEVICE_ID_PREFIX_LETTER_COUNT}}${DEVICE_ID_SEPARATOR}\\d{${DEVICE_ID_NUMBER_COUNT}}${DEVICE_ID_SEPARATOR}[A-Z]{${DEVICE_ID_LETTER_COUNT}}$`,
);

export class DeviceId {
  private constructor(private readonly value: string) {}

  public static create(value: string, deviceType?: string): DeviceId {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
      throw new BadRequestException('Device ID is required');
    }

    if (!DEVICE_ID_PATTERN.test(trimmedValue)) {
      throw new BadRequestException('Device ID must use the format CAM-123-ABC');
    }

    if (deviceType) {
      const expectedPrefix = DeviceId.getPrefixFromDeviceType(deviceType);
      const [actualPrefix] = trimmedValue.split(DEVICE_ID_SEPARATOR);

      if (actualPrefix !== expectedPrefix) {
        throw new BadRequestException(`Device ID prefix must match device type: ${expectedPrefix}`);
      }
    }

    return new DeviceId(trimmedValue);
  }

  public static generate(deviceType: string): string {
    const prefix = DeviceId.getPrefixFromDeviceType(deviceType);
    const numbers = DeviceId.generateRandomNumberPart();
    const letters = DeviceId.generateRandomLetters(DEVICE_ID_LETTER_COUNT);

    return new DeviceId(
      `${prefix}${DEVICE_ID_SEPARATOR}${numbers}${DEVICE_ID_SEPARATOR}${letters}`,
    ).toString();
  }

  public static isEmpty(value: string): void {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
      throw new BadRequestException('Device ID is required');
    }
  }

  public toString(): string {
    return this.value;
  }

  private static generateRandomLetters(length: number): string {
    return Array.from({ length }, () => DeviceId.getRandomLetter()).join('');
  }

  private static getRandomLetter(): string {
    const randomIndex = randomInt(DEVICE_ID_ALPHABET.length);
    return DEVICE_ID_ALPHABET[randomIndex];
  }

  private static generateRandomNumberPart(): string {
    return randomInt(MIN_NUMBER_PART, MAX_NUMBER_PART)
      .toString()
      .padStart(DEVICE_ID_NUMBER_COUNT, '0');
  }

  private static getPrefixFromDeviceType(deviceType: string): string {
    const lettersOnlyDeviceType = deviceType
      ?.trim()
      .replace(/[^a-z]/gi, '')
      .toUpperCase();

    if (!lettersOnlyDeviceType || lettersOnlyDeviceType.length < DEVICE_ID_PREFIX_LETTER_COUNT) {
      throw new BadRequestException('Device type must contain at least 3 letters');
    }

    return lettersOnlyDeviceType.slice(0, DEVICE_ID_PREFIX_LETTER_COUNT);
  }
}
