import { minorUnitDigits } from '../exchange-rates/exchange-rates.service';
import { buildPdf } from '../flight-bookings/e-ticket-pdf';
import type {
  BudgetSummaryDto,
  ItineraryDetailsDto,
} from './dto/itinerary-responses.dto';

type Line = Parameters<typeof buildPdf>[0][number];

const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food',
  accommodation: 'Accommodation',
  in_city_transport: 'In-city transport',
  activities: 'Activities',
  intercity_transport: 'Intercity transport',
};

/** Formats minor units with the currency's own number of decimals. */
export function formatMoney(minorUnits: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return `${(minorUnits / 10 ** digits).toFixed(digits)} ${currency}`;
}

/**
 * ITN-28 (optional): a printable PDF of the itinerary with its days,
 * activities, budget entries, transport and, when exchange rates are
 * available, the budget totals.
 */
export function buildItineraryPdf(
  itinerary: ItineraryDetailsDto,
  budget?: BudgetSummaryDto,
): Buffer {
  const lines: Line[] = [
    { text: itinerary.title, size: 20, bold: true },
    {
      text: `${itinerary.countryNames.join(', ')} | ${itinerary.startDate}${itinerary.endDate ? ` to ${itinerary.endDate}` : ''} | ${itinerary.dayCount} day(s)`,
      gapBefore: 4,
    },
  ];
  if (itinerary.clonedFrom)
    lines.push({
      text: `Based on an itinerary by ${itinerary.clonedFrom.originalAuthorName}`,
      size: 9,
    });

  if (itinerary.groups.length) {
    lines.push({ text: 'Route', size: 14, bold: true, gapBefore: 12 });
    for (const group of itinerary.groups)
      lines.push({
        text: `${group.cityName}: day ${group.firstDay}${group.dayCount > 1 ? `-${group.lastDay}` : ''} (${group.dayCount} day${group.dayCount > 1 ? 's' : ''})`,
      });
  }

  for (const day of itinerary.days) {
    lines.push({
      text: `Day ${day.number} - ${day.date} - ${day.cityName}`,
      size: 13,
      bold: true,
      gapBefore: 12,
    });
    if (day.notes) lines.push({ text: day.notes, size: 10 });
    for (const activity of day.activities)
      lines.push({
        text: `${activity.localTime ? `${activity.localTime}  ` : ''}${activity.name}${activity.cost ? ` (${formatMoney(activity.cost.amountMinorUnits, activity.cost.currency)})` : ''} - ${activity.description}`,
        size: 10,
      });
    for (const entry of day.budgetEntries)
      lines.push({
        text: `Budget: ${CATEGORY_NAMES[entry.category] ?? entry.category}${entry.description ? ` - ${entry.description}` : ''}: ${formatMoney(entry.amountMinorUnits, entry.currency)}`,
        size: 10,
      });
    for (const transport of day.transportCosts)
      lines.push({
        text: `Transport: ${transport.mode} ${transport.fromCityName} to ${transport.toCityName}: ${formatMoney(transport.amountMinorUnits, transport.currency)}`,
        size: 10,
      });
  }

  if (budget) {
    lines.push({ text: 'Budget', size: 14, bold: true, gapBefore: 14 });
    for (const [category, amount] of Object.entries(budget.byCategory))
      lines.push({
        text: `${CATEGORY_NAMES[category] ?? category}: ${formatMoney(amount, budget.currency)}`,
      });
    lines.push(
      {
        text: `Total: ${formatMoney(budget.totalMinorUnits, budget.currency)}`,
        bold: true,
      },
      {
        text: `Converted with exchange rates of ${budget.rateDate}${budget.ratesAreCached ? ' (latest cached rates)' : ''}.`,
        size: 9,
      },
    );
  }
  return buildPdf(lines);
}
