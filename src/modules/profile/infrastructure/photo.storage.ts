import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { UploadedPhoto } from '../profile.upload';

@Injectable()
export class PhotoStorage {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    cloudinary.config({
      cloud_name: config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: config.get('CLOUDINARY_API_SECRET', { infer: true }),
      secure: true,
    });
  }

  async upload(
    folder: string,
    ownerId: string,
    file: UploadedPhoto,
  ): Promise<{ photo_url: string; public_id: string }> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${folder}/${ownerId}`,
          resource_type: 'image',
          type: 'upload',
        },
        (error, uploaded) => {
          if (error) {
            const message =
              error instanceof Error
                ? error.message
                : typeof error === 'object' &&
                    error !== null &&
                    'message' in error &&
                    typeof error.message === 'string'
                  ? error.message
                  : 'Cloudinary upload failed';
            reject(new Error(message));
          } else if (uploaded) {
            resolve(uploaded);
          } else {
            reject(new Error('Cloudinary returned no upload result'));
          }
        },
      );
      stream.end(file.buffer);
    });

    return { photo_url: result.secure_url, public_id: result.public_id };
  }

  async deleteByPublicId(publicId: string | null | undefined): Promise<void> {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }
}
