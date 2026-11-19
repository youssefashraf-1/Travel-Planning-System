import { ApiProperty } from '@nestjs/swagger';
import { CreateCabinDto } from './create-cabin.dto';
import { FlightStatus } from '../schemas/flight.schema';

export class FlightResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() airlineId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty() departureAirportId: string;
  @ApiProperty() arrivalAirportId: string;
  @ApiProperty({ format: 'date-time' }) departureAt: Date;
  @ApiProperty({ format: 'date-time' }) arrivalAt: Date;
  @ApiProperty() departureLocalDate: string;
  @ApiProperty() departureLocalDateTime: string;
  @ApiProperty() arrivalLocalDateTime: string;
  @ApiProperty() departureTimeZone: string;
  @ApiProperty() arrivalTimeZone: string;
  @ApiProperty({ enum: FlightStatus }) status: FlightStatus;
}

export class CabinResponseDto extends CreateCabinDto {
  @ApiProperty() _id: string;
  @ApiProperty() flightId: string;
  @ApiProperty({ example: 0 }) heldSeats: number;
  @ApiProperty({ example: 0 }) bookedSeats: number;
  @ApiProperty() seatsRemaining: number;
}
