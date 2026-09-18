import { BadRequestException } from '@nestjs/common';

export const trimmed = (value: string | undefined | null, fieldName: string): string => {
  if (value === undefined) {
    throw new BadRequestException(`${fieldName} is required`);
  }
  if (value === null) {
    throw new BadRequestException(`${fieldName} is required`);
  }
  return value.trim();
};
