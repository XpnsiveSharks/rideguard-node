import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_MIME_TYPES } from './profile.constants';

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
}

export const profilePhotoUploadOptions: MulterOptions = {
  limits: { fileSize: PROFILE_PHOTO_MAX_BYTES },
  fileFilter: (_request, file, callback) => {
    if (
      !PROFILE_PHOTO_MIME_TYPES.includes(file.mimetype as (typeof PROFILE_PHOTO_MIME_TYPES)[number])
    ) {
      callback(new BadRequestException('Photo must be a JPEG, PNG, or WebP image.'), false);
      return;
    }
    callback(null, true);
  },
};
