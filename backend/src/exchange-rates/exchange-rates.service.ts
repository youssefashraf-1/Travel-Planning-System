import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/currency';
import { Currency } from '../reference-data/schemas/currency.schema';
import { ExchangeRate } from './schemas/exchange-rate.schema';

const FXRATES_URL = 'https://api.fxratesapi.com/latest';
const DAY_MS = 86_400_000;

/** Digits after the decimal point: 2 for EGP or USD, 0 for JPY. */
export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Converts an amount between currencies using rates quoted against one
 * base (units of each currency per 1 base unit). Each side keeps its own
 * minor unit, so 100 JPY is 100 and 1.00 EGP is 100.
 */
export function convertMinorUnits(
  amountMinorUnits: number,
  from: string,
  to: string,
  rates: Map<string, number>,
): number {
  if (from === to) return amountMinorUnits;
  const fromRate = rates.get(from);
  const toRate = rates.get(to);
  if (!fromRate || !toRate)
    throw new ServiceUnavailableException(
      `No exchange rate is available for ${fromRate ? to : from}.`,
    );
  const major = amountMinorUnits / 10 ** minorUnitDigits(from);
  return Math.round((major / fromRate) * toRate * 10 ** minorUnitDigits(to));
}

export interface RateTable {
  base: string;
  rateDate: string;
  fetchedAt: Date;
  rates: Map<string, number>;
  /** True when FXRatesAPI could not be reached and older rates were used. */
  stale: boolean;
}

/**
 * ITN-18: exchange rates from FXRatesAPI, fetched at most once a day
 * through the backend and cached in the database. If the API fails, the
 * last cached rates are used. FXRATES_API_KEY in backend/.env is optional
 * and never leaves the server.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rates: Model<ExchangeRate>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
    private readonly config: ConfigService,
  ) {}

  /** The supported currency codes (GEN-12), for validating input. */
  async supported(): Promise<string[]> {
    const rows = await this.currencies.find().select('_id').lean().exec();
    return rows.map((row) => row._id).sort();
  }

  async assertSupported(currency: string, field = 'currency'): Promise<void> {
    const supported = await this.supported();
    if (!supported.includes(currency))
      throw new BadRequestException(
        `${field} must be one of the supported currencies: ${supported.join(', ')}.`,
      );
  }

  async table(now = new Date()): Promise<RateTable> {
    const cached = await this.rates
      .findOne({ baseCurrency: PLATFORM_CURRENCY })
      .sort({ rateDate: -1, fetchedAt: -1 })
      .lean()
      .exec();
    if (cached && now.getTime() - cached.fetchedAt.getTime() < DAY_MS)
      return this.toTable(cached, false);

    try {
      return this.toTable(await this.fetch(now), false);
    } catch (error) {
      this.logger.warn(
        `FXRatesAPI unavailable (${error instanceof Error ? error.message : 'unknown error'}); using cached rates.`,
      );
      if (cached) return this.toTable(cached, true);
      throw new ServiceUnavailableException(
        'Exchange rates are unavailable right now. Please try again later.',
      );
    }
  }

  private async fetch(now: Date) {
    const supported = await this.supported();
    const url = new URL(FXRATES_URL);
    url.searchParams.set('base', PLATFORM_CURRENCY);
    url.searchParams.set('currencies', supported.join(','));
    const key = this.config.get<string>('FXRATES_API_KEY')?.trim();
    if (key) url.searchParams.set('api_key', key);

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      success?: boolean;
      date?: string;
      rates?: Record<string, number>;
    };
    if (!body.success || !body.rates || !body.date)
      throw new Error('unexpected response');
    const rates = Object.entries(body.rates)
      .filter(
        ([code, rate]) =>
          supported.includes(code) && Number.isFinite(rate) && rate > 0,
      )
      .map(([currencyCode, rate]) => ({ currencyCode, rate }));
    if (!rates.some((r) => r.currencyCode === PLATFORM_CURRENCY))
      rates.push({ currencyCode: PLATFORM_CURRENCY, rate: 1 });

    return this.rates
      .findOneAndUpdate(
        { baseCurrency: PLATFORM_CURRENCY, rateDate: body.date.slice(0, 10) },
        { $set: { rates, fetchedAt: now } },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
  }

  private toTable(
    record: Pick<
      ExchangeRate,
      'baseCurrency' | 'rateDate' | 'fetchedAt' | 'rates'
    >,
    stale: boolean,
  ): RateTable {
    return {
      base: record.baseCurrency,
      rateDate: record.rateDate,
      fetchedAt: record.fetchedAt,
      rates: new Map(record.rates.map((r) => [r.currencyCode, r.rate])),
      stale,
    };
  }
}
