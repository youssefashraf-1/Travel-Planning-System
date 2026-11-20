import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  convertMinorUnits,
  ExchangeRatesService,
  minorUnitDigits,
} from './exchange-rates.service';

describe('currency conversion (ITN-18)', () => {
  // Units of each currency per 1 EGP.
  const rates = new Map([
    ['EGP', 1],
    ['USD', 0.02],
    ['JPY', 3],
  ]);

  it('knows each currency’s minor unit', () => {
    expect(minorUnitDigits('EGP')).toBe(2);
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('converts between minor units, including currencies without cents', () => {
    // 500.00 EGP = 10.00 USD = 1500 JPY
    expect(convertMinorUnits(50_000, 'EGP', 'USD', rates)).toBe(1_000);
    expect(convertMinorUnits(50_000, 'EGP', 'JPY', rates)).toBe(1_500);
    expect(convertMinorUnits(1_500, 'JPY', 'EGP', rates)).toBe(50_000);
    expect(convertMinorUnits(1_000, 'USD', 'JPY', rates)).toBe(1_500);
    expect(convertMinorUnits(123, 'USD', 'USD', rates)).toBe(123);
  });

  it('refuses a currency without a rate', () => {
    expect(() => convertMinorUnits(1, 'EGP', 'GBP', rates)).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('ExchangeRatesService (ITN-18)', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const cached = {
    baseCurrency: 'EGP',
    rateDate: '2026-11-17',
    fetchedAt: new Date('2026-11-17T08:00:00Z'),
    rates: [
      { currencyCode: 'EGP', rate: 1 },
      { currencyCode: 'USD', rate: 0.021 },
    ],
  };
  const chain = (result: unknown) => {
    const query: Record<string, jest.Mock> = {};
    for (const m of ['sort', 'select', 'lean']) query[m] = jest.fn(() => query);
    query.exec = jest.fn().mockResolvedValue(result);
    return query;
  };
  const rateModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const currencyModel = {
    find: jest.fn(() => chain([{ _id: 'EGP' }, { _id: 'USD' }])),
  };
  const config = { get: jest.fn() } as unknown as ConfigService;
  const service = new ExchangeRatesService(
    rateModel as any,
    currencyModel as any,
    config,
  );
  const fetchSpy = jest.spyOn(global, 'fetch');

  afterEach(() => jest.clearAllMocks());
  afterAll(() => fetchSpy.mockRestore());

  it('uses rates fetched in the last 24 hours without calling the API', async () => {
    rateModel.findOne.mockReturnValue(
      chain({ ...cached, fetchedAt: new Date('2026-11-19T01:00:00Z') }),
    );
    const table = await service.table(now);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(table).toMatchObject({ rateDate: '2026-11-17', stale: false });
  });

  it('fetches once a day and stores the result', async () => {
    rateModel.findOne.mockReturnValue(chain(cached));
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          date: '2026-11-19T11:00:00.000Z',
          rates: { USD: 0.02, EGP: 1, XYZ: 9 },
        }),
      ),
    );
    rateModel.findOneAndUpdate.mockReturnValue(
      chain({
        ...cached,
        rateDate: '2026-11-19',
        fetchedAt: now,
        rates: [
          { currencyCode: 'EGP', rate: 1 },
          { currencyCode: 'USD', rate: 0.02 },
        ],
      }),
    );

    const table = await service.table(now);
    expect((fetchSpy.mock.calls[0][0] as URL).href).toContain('base=EGP');
    const [filter, update] = rateModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ baseCurrency: 'EGP', rateDate: '2026-11-19' });
    // Unsupported currencies are not stored.
    expect(update.$set.rates).toEqual([
      { currencyCode: 'USD', rate: 0.02 },
      { currencyCode: 'EGP', rate: 1 },
    ]);
    expect(table).toMatchObject({ rateDate: '2026-11-19', stale: false });
  });

  it('falls back to the last cached rates when the API fails', async () => {
    rateModel.findOne.mockReturnValue(chain(cached));
    fetchSpy.mockRejectedValue(new Error('network down'));
    const table = await service.table(now);
    expect(table).toMatchObject({ rateDate: '2026-11-17', stale: true });
    expect(table.rates.get('USD')).toBe(0.021);
  });

  it('reports 503 when the API fails and nothing is cached', async () => {
    rateModel.findOne.mockReturnValue(chain(null));
    fetchSpy.mockResolvedValue(new Response('busy', { status: 500 }));
    await expect(service.table(now)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects unsupported currencies', async () => {
    await expect(service.assertSupported('XYZ')).rejects.toThrow(
      'supported currencies: EGP, USD',
    );
  });
});
