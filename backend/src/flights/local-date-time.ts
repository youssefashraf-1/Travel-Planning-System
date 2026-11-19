import { BadRequestException } from '@nestjs/common';
import { isCalendarDate } from '../common/validation/calendar-date';
import {
  isIanaTimeZone,
  LOCAL_TIME_PATTERN,
} from '../common/validation/local-time';

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function localText(date: Date, format: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(
    format.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function airportLocalDateTime(date: Date, timeZone: string): string {
  return localText(date, formatter(timeZone)).slice(0, 16);
}

/**
 * Convert an airport wall-clock minute using the runtime IANA database.
 * Probe nearby offsets, then round-trip every candidate. Zero candidates is
 * a DST gap; two candidates is a repeated hour. Reject both rather than
 * silently choosing a different time. Input has no UTC offset or Z suffix.
 */
export function airportLocalToUtc(value: string, timeZone: string): Date {
  const [date, time, extra] = value.split('T');
  if (
    extra !== undefined ||
    !isCalendarDate(date) ||
    !LOCAL_TIME_PATTERN.test(time ?? '') ||
    !isIanaTimeZone(timeZone)
  ) {
    throw new BadRequestException(
      'Use a real airport local date-time in YYYY-MM-DDTHH:mm format.',
    );
  }
  const wall = Date.parse(`${value}:00.000Z`);
  const format = formatter(timeZone);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(wall + hours * 3_600_000);
    offsets.add(Date.parse(`${localText(sample, format)}Z`) - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((candidate) => localText(candidate, format) === `${value}:00`);
  if (candidates.length === 0) {
    throw new BadRequestException(
      `The local time does not exist in ${timeZone} because of a clock change.`,
    );
  }
  if (candidates.length !== 1) {
    throw new BadRequestException(
      `The local time occurs twice in ${timeZone} because of a clock change. Choose an unambiguous time.`,
    );
  }
  return candidates[0];
}
