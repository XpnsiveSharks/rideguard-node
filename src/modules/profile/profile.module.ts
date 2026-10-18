import { Module, Global } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './infrastructure/profile.repository';
import { ContactRepository } from './infrastructure/contact.repository';
import { PhotoStorage } from './infrastructure/photo.storage';

@Global()
@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository, ContactRepository, PhotoStorage],
  exports: [ProfileService],
})
export class ProfileModule {}
