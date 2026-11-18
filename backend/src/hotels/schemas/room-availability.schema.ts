import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { isCalendarDate } from '../../common/validation/calendar-date';
import { Room } from './room.schema';

@Schema({ _id: false })
class RoomDateRange {
  @Prop({ required: true, validate: isCalendarDate })
  fromDate: string;

  @Prop({ required: true, validate: isCalendarDate })
  untilDate: string;
}

const RoomDateRangeSchema = SchemaFactory.createForClass(RoomDateRange);

function hasDisjointRanges(ranges: (RoomDateRange | null)[]): boolean {
  if (
    ranges.some(
      (range) =>
        !range ||
        !isCalendarDate(range.fromDate) ||
        !isCalendarDate(range.untilDate) ||
        range.fromDate >= range.untilDate,
    )
  ) {
    return false;
  }

  const sorted = ranges
    .filter((range) => range !== null)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  return sorted.every(
    (range, index) =>
      index === 0 || sorted[index - 1].untilDate <= range.fromDate,
  );
}

const dateRangeListOptions = {
  type: [RoomDateRangeSchema],
  default: [],
  required: true,
  castNonArrays: false,
  validate: {
    validator: hasDisjointRanges,
    message: 'Ranges must have an end after their start and must not overlap.',
  },
};

@Schema({ timestamps: true, optimisticConcurrency: true })
export class RoomAvailability {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Room.name,
    required: true,
    unique: true,
  })
  roomId: Types.ObjectId;

  @Prop(dateRangeListOptions)
  bookableRanges: RoomDateRange[];

  @Prop(dateRangeListOptions)
  blockedRanges: RoomDateRange[];
}

export const RoomAvailabilitySchema =
  SchemaFactory.createForClass(RoomAvailability);
