import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((error) => error.property) };
}

describe('UpdateProfileDto (ACC-09)', () => {
  it('accepts valid fields and normalizes them', async () => {
    const { dto, fields } = await check({
      name: '  Mona H. ',
      phone: ' +20 (100) 123-4567 ',
      preferredCurrency: ' egp ',
    });

    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      name: 'Mona H.',
      phone: '+20 (100) 123-4567',
      preferredCurrency: 'EGP',
    });
  });

  it('turns empty phone and currency into null (remove)', async () => {
    const { dto, fields } = await check({ phone: '', preferredCurrency: '' });

    expect(fields).toEqual([]);
    expect(dto.phone).toBeNull();
    expect(dto.preferredCurrency).toBeNull();
  });

  it.each([
    ['a blank name', { name: '  ' }, 'name'],
    ['a name over 100 characters', { name: 'a'.repeat(101) }, 'name'],
    ['letters in the phone', { phone: '+20 abc 1234' }, 'phone'],
    ['a phone with too few digits', { phone: '12345' }, 'phone'],
    ['a phone with too many digits', { phone: '1234567890123456' }, 'phone'],
    [
      'a currency that is not three letters',
      { preferredCurrency: 'EURO' },
      'preferredCurrency',
    ],
    ['an email change', { email: 'new@example.com' }, 'email'],
    ['a role change', { role: 'admin' }, 'role'],
  ])('rejects %s', async (_case, body, field) => {
    const { fields } = await check(body);
    expect(fields).toContain(field);
  });
});
