import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';

const DEVICE_ID_LETTER_COUNT = 3;
const DEVICE_ID_NUMBER_COUNT = 3;
const DEVICE_ID_SEPARATOR = '-';
const DEVICE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const MIN_NUMBER_PART = 0;
const MAX_NUMBER_PART = 10 ** DEVICE_ID_NUMBER_COUNT;
const DEVICE_ID_PATTERN = new RegExp(
  `^[A-Z]{${DEVICE_ID_LETTER_COUNT}}${DEVICE_ID_SEPARATOR}\\d{${DEVICE_ID_NUMBER_COUNT}}$`,
);

export class DeviceId {
  private constructor(private readonly value: string) {}

  public static create(value: string): DeviceId {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
      throw new BadRequestException('Device ID is required');
    }

    if (!DEVICE_ID_PATTERN.test(trimmedValue)) {
      throw new BadRequestException('Device ID must use the format ABC-123');
    }

    return new DeviceId(trimmedValue);
  }

  public static generate(): string {
    const letters = DeviceId.generateRandomLetters(DEVICE_ID_LETTER_COUNT);
    const numbers = DeviceId.generateRandomNumberPart();

    return new DeviceId(`${letters}${DEVICE_ID_SEPARATOR}${numbers}`).toString();
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
}
