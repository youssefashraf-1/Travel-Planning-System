import type { FlightBookingDto } from './dto/flight-booking-response.dto';

interface Line {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
}

const PAGE_WIDTH = 595; // A4 in points
const PAGE_HEIGHT = 842;
const MARGIN = 50;

/**
 * The built-in PDF fonts only cover Latin-1, so other characters (for
 * example Arabic names) become "?". The booking details page shows them
 * correctly.
 */
function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/[\\()]/g, (char) => `\\${char}`);
}

/** A minimal text-only PDF: Helvetica, A4 pages, no external library. */
export function buildPdf(lines: Line[]): Buffer {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 11;
    const step = (line.gapBefore ?? 0) + size * 1.5;
    if (y - step < MARGIN && ops.length > 0) {
      pages.push(ops.join('\n'));
      ops = [];
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= step;
    ops.push(
      `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf ${MARGIN} ${y.toFixed(1)} Td (${pdfText(line.text)}) Tj ET`,
    );
  }
  pages.push(ops.join('\n'));

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, then a page and its
  // content stream for every page.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((content, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function money(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency}`;
}

const CABIN_NAMES: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

/** FLT-23: the downloadable e-ticket for a confirmed booking. */
export function buildETicketPdf(booking: FlightBookingDto): Buffer {
  const lines: Line[] = [
    { text: 'E-TICKET', size: 20, bold: true },
    {
      text: `Booking reference: ${booking.reference ?? '-'}`,
      size: 14,
      bold: true,
      gapBefore: 6,
    },
    { text: `Status: ${booking.status}` },
    { text: 'Flights', size: 14, bold: true, gapBefore: 12 },
  ];
  for (const segment of booking.segments) {
    lines.push(
      {
        text: `${segment.leg === 'outbound' ? 'Outbound' : 'Return'}: ${segment.airlineName} ${segment.flightNumber} - ${CABIN_NAMES[segment.cabinClass] ?? segment.cabinClass}`,
        bold: true,
        gapBefore: 4,
      },
      {
        text: `From ${segment.departureAirport.iataCode} ${segment.departureAirport.name}: ${segment.departureLocalDateTime.replace('T', ' ')} (${segment.departureAirport.timeZone})`,
      },
      {
        text: `To ${segment.arrivalAirport.iataCode} ${segment.arrivalAirport.name}: ${segment.arrivalLocalDateTime.replace('T', ' ')} (${segment.arrivalAirport.timeZone})`,
      },
      {
        text: `Free baggage: ${segment.freeBagCount} bag(s), up to ${segment.maxBagWeightKg} kg each`,
      },
    );
  }
  lines.push({ text: 'Passengers', size: 14, bold: true, gapBefore: 12 });
  booking.passengers.forEach((passenger, index) => {
    lines.push({
      text: `${index + 1}. ${passenger.fullName} (${passenger.segments[0].type}) - document ${passenger.passportOrIdNumber}`,
      gapBefore: 2,
    });
    for (const selection of passenger.segments) {
      if (selection.seat)
        lines.push({ text: `   Seat (${selection.leg}): ${selection.seat}` });
      if (selection.extraBagWeightsKg.length > 0)
        lines.push({
          text: `   Extra bags (${selection.leg}): ${selection.extraBagWeightsKg.map((kg) => `${kg} kg`).join(', ')}`,
        });
    }
  });
  lines.push(
    { text: 'Payment', size: 14, bold: true, gapBefore: 12 },
    { text: `Fares: ${money(booking.faresMinorUnits, booking.currency)}` },
    {
      text: `Baggage fees: ${money(booking.baggageFeesMinorUnits, booking.currency)}`,
    },
    {
      text: `Total paid: ${money(booking.totalMinorUnits, booking.currency)}`,
      bold: true,
    },
    {
      text: 'Times are local to each airport. Bring the passport or ID used for this booking.',
      size: 9,
      gapBefore: 16,
    },
  );
  return buildPdf(lines);
}
