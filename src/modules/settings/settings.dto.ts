import { IsIn } from 'class-validator';

export type AutoArchiveHours = 24 | 48 | 72 | null;

export class UpdateAutoArchiveDto {
  @IsIn([24, 48, 72, null], {
    message: 'autoArchiveHours must be 24, 48, 72, or null',
  })
  autoArchiveHours!: AutoArchiveHours;
}

export interface AutoArchiveResponse {
  autoArchiveHours: AutoArchiveHours;
}
