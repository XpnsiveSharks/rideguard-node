import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_DELETION_KEY = 'allowDuringDeletion';
export const AllowDuringDeletion = () => SetMetadata(ALLOW_DURING_DELETION_KEY, true);
