import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageInfoDto } from '../../common/pagination';
import { BudgetCategory } from '../schemas/budget-entry.schema';
import { ItineraryVisibility } from '../schemas/itinerary.schema';

export class MoneyViewDto {
  @ApiProperty({ example: 50000 }) amountMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
}

export class ImageViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: '/uploads/activities/3f1c….jpg' }) url: string;
}

export class ActivityViewDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional({ example: '10:30' }) localTime?: string;
  @ApiPropertyOptional({ type: MoneyViewDto }) cost?: MoneyViewDto;
  @ApiProperty({ type: [ImageViewDto] }) images: ImageViewDto[];
}

export class BudgetViewDto extends MoneyViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: BudgetCategory }) category: BudgetCategory;
  @ApiPropertyOptional() description?: string;
}

export class TransportViewDto extends MoneyViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Train' }) mode: string;
  @ApiProperty({ example: 'cairo' }) fromCityId: string;
  @ApiProperty({ example: 'Cairo' }) fromCityName: string;
  @ApiProperty({ example: 'paris' }) toCityId: string;
  @ApiProperty({ example: 'Paris' }) toCityName: string;
}

/** ITN-27 (optional): a booking linked to a day. */
export class LinkedBookingViewDto {
  @ApiProperty({ description: 'The link id, for unlinking.' }) id: string;
  @ApiProperty({ enum: ['flight', 'hotel'] }) bookingType: 'flight' | 'hotel';
  @ApiProperty() bookingId: string;
  @ApiPropertyOptional({ example: 'K7Q2MX' }) reference?: string;
  @ApiProperty({ example: 'confirmed' }) status: string;
  @ApiProperty({ example: 'Flight NA101' }) title: string;
  @ApiProperty({ example: 650000 }) amountMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    description:
      'True while the booking is confirmed or completed; cancelled bookings stop counting.',
  })
  countsInBudget: boolean;
}

export class DayViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 1, description: 'Days are numbered from 1.' })
  number: number;
  @ApiProperty({
    example: '2027-03-01',
    description: 'Start date + (number − 1).',
  })
  date: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 'Cairo' }) cityName: string;
  @ApiProperty({ example: 'EG' }) countryCode: string;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty({ type: [ActivityViewDto] }) activities: ActivityViewDto[];
  @ApiProperty({ type: [BudgetViewDto] }) budgetEntries: BudgetViewDto[];
  @ApiProperty({ type: [TransportViewDto] }) transportCosts: TransportViewDto[];
  @ApiProperty({ type: [LinkedBookingViewDto] })
  linkedBookings: LinkedBookingViewDto[];
}

/** ITN-09: consecutive days in the same city. */
export class CityGroupDto {
  @ApiProperty({ example: 1, description: 'Group number, from 1.' })
  number: number;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 'Cairo' }) cityName: string;
  @ApiProperty({ example: 1 }) firstDay: number;
  @ApiProperty({ example: 3 }) lastDay: number;
  @ApiProperty({ example: 3 }) dayCount: number;
  @ApiProperty({ example: '2027-03-01' }) startDate: string;
  @ApiProperty({ example: '2027-03-03' }) endDate: string;
}

export class ItinerarySummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Ten days in Egypt' }) title: string;
  @ApiProperty({ type: [String], example: ['EG'] }) countryCodes: string[];
  @ApiProperty({ type: [String], example: ['Egypt'] }) countryNames: string[];
  @ApiProperty({ example: '2027-03-01' }) startDate: string;
  @ApiPropertyOptional({
    example: '2027-03-10',
    description: 'Last day’s date.',
  })
  endDate?: string;
  @ApiProperty({ example: 10 }) dayCount: number;
  @ApiProperty({ enum: ItineraryVisibility }) visibility: ItineraryVisibility;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class ItineraryListDto extends PageInfoDto {
  @ApiProperty({ type: [ItinerarySummaryDto] }) items: ItinerarySummaryDto[];
}

export class AttributionDto {
  @ApiProperty() sourceItineraryId: string;
  @ApiProperty() originalAuthorId: string;
  @ApiProperty({ example: 'Mona Hassan' }) originalAuthorName: string;
}

export class ItineraryDetailsDto extends ItinerarySummaryDto {
  @ApiProperty({ type: [DayViewDto] }) days: DayViewDto[];
  @ApiProperty({ type: [CityGroupDto] }) groups: CityGroupDto[];
  @ApiPropertyOptional({
    type: AttributionDto,
    description: 'ITN-21: set on clones, crediting the original author.',
  })
  clonedFrom?: AttributionDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class PublicItineraryDto extends ItineraryDetailsDto {
  @ApiProperty() authorId: string;
  @ApiProperty({ example: 'Mona Hassan' }) authorName: string;
}

export enum SummaryCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
  INTERCITY_TRANSPORT = 'intercity_transport',
}

export class CategoryTotalsDto {
  @ApiProperty() food: number;
  @ApiProperty() accommodation: number;
  @ApiProperty({ name: 'in_city_transport' }) in_city_transport: number;
  @ApiProperty({ description: 'Budget entries plus activity costs (ITN-10).' })
  activities: number;
  @ApiProperty({
    name: 'intercity_transport',
    description: 'Transport cost entries (ITN-16).',
  })
  intercity_transport: number;
}

export class DayTotalDto {
  @ApiProperty() dayId: string;
  @ApiProperty() number: number;
  @ApiProperty() date: string;
  @ApiProperty() cityName: string;
  @ApiProperty() totalMinorUnits: number;
  @ApiProperty({ type: CategoryTotalsDto }) byCategory: CategoryTotalsDto;
}

export class GroupTotalDto extends CityGroupDto {
  @ApiProperty() subtotalMinorUnits: number;
}

/** ITN-14, ITN-18: the whole budget in one display currency. */
export class BudgetSummaryDto {
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: 152300 }) totalMinorUnits: number;
  @ApiProperty({ type: CategoryTotalsDto }) byCategory: CategoryTotalsDto;
  @ApiProperty({ type: [DayTotalDto] }) byDay: DayTotalDto[];
  @ApiProperty({ type: [GroupTotalDto] }) byGroup: GroupTotalDto[];
  @ApiProperty({
    example: '2026-11-19',
    description: 'The date of the exchange rates used.',
  })
  rateDate: string;
  @ApiProperty({
    description:
      'True when FXRatesAPI was unavailable and the last cached rates were used.',
  })
  ratesAreCached: boolean;
}

export class PublicItineraryViewDto extends PublicItineraryDto {
  @ApiPropertyOptional({
    type: BudgetSummaryDto,
    description: 'Missing only if no exchange rates are available at all.',
  })
  budget?: BudgetSummaryDto;
}

export class PublicSearchItemDto extends ItinerarySummaryDto {
  @ApiProperty({ example: 'Mona Hassan' }) authorName: string;
  @ApiProperty({ type: [String], example: ['Cairo', 'Luxor'] })
  cityNames: string[];
}

export class PublicSearchResultDto extends PageInfoDto {
  @ApiProperty({ type: [PublicSearchItemDto] }) items: PublicSearchItemDto[];
}
