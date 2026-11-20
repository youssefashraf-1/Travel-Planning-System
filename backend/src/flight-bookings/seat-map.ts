import { CabinClass } from '../flights/schemas/cabin-inventory.schema';

/**
 * FLT-28 (optional): every cabin gets a simple seat map from its seat
 * count. First and business have 4 seats a row (A C D F); premium economy
 * and economy have 6 (A–F). Rows start at different numbers so seat labels
 * never repeat between cabins of one flight.
 */
const LAYOUT: Record<CabinClass, { firstRow: number; letters: string[] }> = {
  [CabinClass.FIRST]: { firstRow: 1, letters: ['A', 'C', 'D', 'F'] },
  [CabinClass.BUSINESS]: { firstRow: 3, letters: ['A', 'C', 'D', 'F'] },
  [CabinClass.PREMIUM_ECONOMY]: {
    firstRow: 12,
    letters: ['A', 'B', 'C', 'D', 'E', 'F'],
  },
  [CabinClass.ECONOMY]: {
    firstRow: 20,
    letters: ['A', 'B', 'C', 'D', 'E', 'F'],
  },
};

/** All seat labels of a cabin, row by row. */
export function seatLabels(
  cabinClass: CabinClass,
  totalSeats: number,
): string[] {
  const { firstRow, letters } = LAYOUT[cabinClass];
  return Array.from(
    { length: totalSeats },
    (_, i) =>
      `${firstRow + Math.floor(i / letters.length)}${letters[i % letters.length]}`,
  );
}

export function isSeatInCabin(
  seat: string,
  cabinClass: CabinClass,
  totalSeats: number,
): boolean {
  return seatLabels(cabinClass, totalSeats).includes(seat.toUpperCase());
}
