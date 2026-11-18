import 'reflect-metadata';
import {
  createConnection,
  type Connection,
  type Model,
  type QueryFilter,
  type UpdateQuery,
} from 'mongoose';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import { readReferenceData, validateReferenceLinks } from './reference-data';
import { Attraction, AttractionSchema } from './schemas/attraction.schema';
import { City, CitySchema } from './schemas/city.schema';
import { Country, CountrySchema } from './schemas/country.schema';
import { Currency, CurrencySchema } from './schemas/currency.schema';

async function upsertBySourceId<T extends { _id: string }>(
  model: Model<T>,
  rows: T[],
) {
  for (const { _id, ...fields } of rows) {
    await model.updateOne(
      { _id } as QueryFilter<T>,
      { $set: fields, $setOnInsert: { _id } } as UpdateQuery<T>,
      { upsert: true },
    );
  }
}

async function seedReferenceData(connection: Connection): Promise<void> {
  const data = readReferenceData();
  validateReferenceLinks(data);

  const currencyRows = Array.from(
    new Set(data.countries.map((country) => country.currencyCode)),
    (code) => ({ _id: code }),
  );
  const currencies = connection.model(Currency.name, CurrencySchema);
  const countries = connection.model(Country.name, CountrySchema);
  const cities = connection.model(City.name, CitySchema);
  const airports = connection.model(Airport.name, AirportSchema);
  const attractions = connection.model(Attraction.name, AttractionSchema);

  await Promise.all([
    ...currencyRows.map((row) => new currencies(row).validate()),
    ...data.countries.map((row) => new countries(row).validate()),
    ...data.cities.map((row) => new cities(row).validate()),
    ...data.airports.map((row) => new airports(row).validate()),
    ...data.attractions.map((row) => new attractions(row).validate()),
  ]);
  await Promise.all([
    countries.createIndexes(),
    cities.createIndexes(),
    airports.createIndexes(),
    attractions.createIndexes(),
  ]);

  await upsertBySourceId(currencies, currencyRows);
  await upsertBySourceId(countries, data.countries);
  await upsertBySourceId(cities, data.cities);
  await airports.bulkWrite(
    data.airports.map((row) => ({
      updateOne: {
        filter: { iataCode: row.iataCode },
        update: { $set: row },
        upsert: true,
      },
    })),
  );
  await upsertBySourceId(attractions, data.attractions);

  console.log(
    `Seeded ${data.countries.length} countries, ${data.cities.length} cities, ` +
      `${data.airports.length} airports, ${data.attractions.length} attractions, and ` +
      `${currencyRows.length} currencies.`,
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      'Set MONGODB_URI in backend/.env or in the environment before seeding.',
    );
    process.exitCode = 1;
    return;
  }

  const connection = createConnection();
  try {
    await connection.openUri(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 8000,
    });
    await seedReferenceData(connection);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Unknown error';
    console.error(
      `Reference data seed failed (${name}). Verify the database connection, write access, and reference data.`,
    );
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  void main();
}
