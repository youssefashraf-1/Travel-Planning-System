import { airportLocalDateTime } from '../flights/local-date-time';

/**
 * Hotel dates are YYYY-MM-DD strings in the hotel's own calendar. A range
 * or stay includes its first date and excludes its last: a stay from the
 * 1st to the 3rd is the nights of the 1st and 2nd, and a range ending on
 * the 3rd lets a new stay begin on the 3rd.
 */
export interface DateRange {
  fromDate: string;
  untilDate: string;
}

const DAY_MS = 86_400_000;

/** Whole nights between two dates. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every date from `from` up to, but not including, `until`. */
export function datesBetween(from: string, until: string): string[] {
  const dates: string[] = [];
  for (let date = from; date < until; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** True when the two half-open ranges share at least one night. */
export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.fromDate < b.untilDate && b.fromDate < a.untilDate;
}

/**
 * True when the ranges cover every night of the stay. Ranges that meet end
 * to start (one ends on the 5th, the next starts on the 5th) count as one.
 */
export function coversStay(ranges: DateRange[], stay: DateRange): boolean {
  let coveredUntil = stay.fromDate;
  for (const range of [...ranges].sort((a, b) =>
    a.fromDate.localeCompare(b.fromDate),
  )) {
    if (range.fromDate > coveredUntil) break;
    if (range.untilDate > coveredUntil) coveredUntil = range.untilDate;
    if (coveredUntil >= stay.untilDate) return true;
  }
  return coveredUntil >= stay.untilDate;
}

/** True when the ranges overlap each other (touching ends is fine). */
export function hasOverlaps(ranges: DateRange[]): boolean {
  const sorted = [...ranges].sort((a, b) =>
    a.fromDate.localeCompare(b.fromDate),
  );
  return sorted.some(
    (range, index) => index > 0 && sorted[index - 1].untilDate > range.fromDate,
  );
}

/** The current date and HH:mm time in the hotel's time zone. */
export function hotelNow(timeZone: string, now = new Date()) {
  const local = airportLocalDateTime(now, timeZone);
  return { date: local.slice(0, 10), dateTime: local };
}
