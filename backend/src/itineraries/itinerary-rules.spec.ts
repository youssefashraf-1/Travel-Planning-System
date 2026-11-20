import { imageExtension } from '../common/uploads/image-uploads.service';
import { cityGroups, dayDate } from './itinerary-presenter';

describe('itinerary rules', () => {
  it('dates each day from the start date (ITN-05)', () => {
    expect(dayDate('2027-02-27', 0)).toBe('2027-02-27');
    expect(dayDate('2027-02-27', 2)).toBe('2027-03-01');
  });

  it('groups consecutive days in the same city (ITN-09)', () => {
    const days = ['cairo', 'cairo', 'luxor', 'cairo'].map((cityId) => ({
      cityId,
    }));
    const groups = cityGroups(
      { startDate: '2027-03-01', days } as never,
      (id) => id.toUpperCase(),
    );
    expect(groups).toEqual([
      expect.objectContaining({
        number: 1,
        cityName: 'CAIRO',
        firstDay: 1,
        lastDay: 2,
        dayCount: 2,
        startDate: '2027-03-01',
        endDate: '2027-03-02',
      }),
      expect.objectContaining({
        number: 2,
        cityId: 'luxor',
        firstDay: 3,
        dayCount: 1,
      }),
      expect.objectContaining({
        number: 3,
        cityId: 'cairo',
        firstDay: 4,
        endDate: '2027-03-04',
      }),
    ]);
    expect(
      cityGroups({ startDate: '2027-03-01', days: [] } as never, String),
    ).toEqual([]);
  });

  it('recognises JPG and PNG by content, not by name (GEN-08)', () => {
    expect(imageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(
      imageExtension(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe('png');
    expect(imageExtension(Buffer.from('GIF89a'))).toBeNull();
    expect(imageExtension(Buffer.from('<svg></svg>'))).toBeNull();
  });
});
