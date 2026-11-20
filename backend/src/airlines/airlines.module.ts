import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import { ProviderMediaService } from '../common/uploads/provider-media.service';
import { AuthModule } from '../auth/auth.module';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from './schemas/airline.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Airline.name, schema: AirlineSchema }]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService, ImageUploadsService, ProviderMediaService],
  exports: [AirlinesService],
})
export class AirlinesModule {}
