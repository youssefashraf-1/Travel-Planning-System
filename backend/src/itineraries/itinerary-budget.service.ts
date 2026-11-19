import { Injectable } from '@nestjs/common';
import { PLATFORM_CURRENCY } from '../common/currency';
import {
  convertMinorUnits,
  ExchangeRatesService,
} from '../exchange-rates/exchange-rates.service';
import {
  BudgetSummaryDto,
  CategoryTotalsDto,
  SummaryCategory,
} from './dto/itinerary-responses.dto';
import {
  cityGroups,
  dayDate,
  ItineraryPresenter,
  StoredItinerary,
} from './itinerary-presenter';

function emptyTotals(): CategoryTotalsDto {
  return {
    food: 0,
    accommodation: 0,
    in_city_transport: 0,
    activities: 0,
    intercity_transport: 0,
  };
}

const sum = (totals: CategoryTotalsDto) =>
  Object.values(totals).reduce((a: number, b: number) => a + b, 0);

/**
 * ITN-14, ITN-18: the itinerary's whole budget in one currency, by
 * category, day and city group. Totals include budget entries, activity
 * costs (under Activities) and intercity transport. Bookings are not
 * converted (PAY-04).
 */
@Injectable()
export class ItineraryBudgetService {
  constructor(
    private readonly exchangeRates: ExchangeRatesService,
    private readonly presenter: ItineraryPresenter,
  ) {}

  async summary(
    itinerary: StoredItinerary,
    displayCurrency: string | undefined,
    now = new Date(),
  ): Promise<BudgetSummaryDto> {
    const currency = displayCurrency ?? PLATFORM_CURRENCY;
    await this.exchangeRates.assertSupported(currency);
    const table = await this.exchangeRates.table(now);
    const convert = (amount: number, from: string) =>
      convertMinorUnits(amount, from, currency, table.rates);
    const names = await this.presenter.names([itinerary]);

    const total = emptyTotals();
    const byDay = itinerary.days.map((day, index) => {
      const totals = emptyTotals();
      const add = (category: SummaryCategory, amount: number, from: string) => {
        const value = convert(amount, from);
        totals[category] += value;
        total[category] += value;
      };
      for (const entry of day.budgetEntries)
        add(
          entry.category as unknown as SummaryCategory,
          entry.amountMinorUnits,
          entry.currency,
        );
      for (const activity of day.activities)
        if (activity.cost)
          add(
            SummaryCategory.ACTIVITIES,
            activity.cost.amountMinorUnits,
            activity.cost.currency,
          );
      for (const transport of day.transportCosts)
        add(
          SummaryCategory.INTERCITY_TRANSPORT,
          transport.amountMinorUnits,
          transport.currency,
        );
      return {
        dayId: (
          day as unknown as { _id: { toString(): string } }
        )._id.toString(),
        number: index + 1,
        date: dayDate(itinerary.startDate, index),
        cityName: names.city(day.cityId),
        totalMinorUnits: sum(totals),
        byCategory: totals,
      };
    });

    return {
      currency,
      totalMinorUnits: sum(total),
      byCategory: total,
      byDay,
      byGroup: cityGroups(itinerary, names.city).map((group) =>
        Object.assign(group, {
          subtotalMinorUnits: byDay
            .slice(group.firstDay - 1, group.lastDay)
            .reduce((s, day) => s + day.totalMinorUnits, 0),
        }),
      ),
      rateDate: table.rateDate,
      ratesAreCached: table.stale,
    };
  }
}
