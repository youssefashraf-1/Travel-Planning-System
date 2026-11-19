import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchFlightsDto } from './search-flights.dto';

describe('Search query DTO', () => {
  const route = {
    departureAirportId: '507f1f77bcf86cd799439011',
    arrivalAirportId: '507f1f77bcf86cd799439012',
    departureDate: '2031-05-10',
  };
  it('defaults to one adult, no children/infants, first page and ascending departures', async () => {
    const dto = plainToInstance(SearchFlightsDto, route);
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({
      adults: 1,
      children: 0,
      infants: 0,
      page: 1,
      sortBy: 'departureTime',
      sortOrder: 'asc',
    });
  });
  it('converts numeric query strings without coercing empty text into zero', async () => {
    const dto = plainToInstance(SearchFlightsDto, {
      ...route,
      adults: '2',
      children: '1',
      minPriceMinorUnits: '0',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.adults).toBe(2);
    expect(dto.minPriceMinorUnits).toBe(0);
    expect(
      await validate(
        plainToInstance(SearchFlightsDto, { ...route, children: '' }),
      ),
    ).not.toHaveLength(0);
  });
});
