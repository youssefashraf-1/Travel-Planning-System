import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Currency,
  CurrencySchema,
} from '../reference-data/schemas/currency.schema';
import { ExchangeRatesService } from './exchange-rates.service';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';

/** ITN-18: daily cached exchange rates from FXRatesAPI. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
  ],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
