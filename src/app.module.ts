import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  // controllers: [AppController],
  // providers: [AppService],
})
export class AppModule {}
