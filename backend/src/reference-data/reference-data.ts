import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Airport } from '../airports/schemas/airport.schema';
import { type Attraction } from './schemas/attraction.schema';
import { type City } from './schemas/city.schema';
import { type Country } from './schemas/country.schema';

export interface ReferenceData {
  countries: Country[];
  cities: City[];
  airports: Airport[];
  attractions: Attraction[];
}

export function readReferenceData(): ReferenceData {
  const source = join(__dirname, 'data', 'reference-data.json');
  return JSON.parse(readFileSync(source, 'utf8')) as ReferenceData;
}

function indexRows<T>(
  rows: T[],
  key: (row: T) => string,
  label: string,
): Map<string, T> {
  const indexed = new Map(rows.map((row) => [key(row), row]));
  if (!indexed.size || indexed.size !== rows.length) {
    throw new Error(
      `Reference ${label} must be nonempty with unique identifiers.`,
    );
  }
  return indexed;
}

export function validateReferenceLinks(data: ReferenceData): void {
  const countries = indexRows(data.countries, (row) => row._id, 'countries');
  const cities = indexRows(data.cities, (row) => row._id, 'cities');
  indexRows(data.airports, (row) => row.iataCode, 'airports');
  indexRows(data.attractions, (row) => row._id, 'attractions');

  for (const city of data.cities) {
    if (!countries.has(city.countryCode)) {
      throw new Error(`City ${city._id} references an unknown country.`);
    }
  }
  for (const airport of data.airports) {
    const city = cities.get(airport.cityId);
    if (!city || city.countryCode !== airport.countryCode) {
      throw new Error(
        `Airport ${airport.iataCode} has an invalid city or country.`,
      );
    }
  }
  for (const attraction of data.attractions) {
    if (!cities.has(attraction.cityId)) {
      throw new Error(
        `Attraction ${attraction._id} references an unknown city.`,
      );
    }
  }
}
