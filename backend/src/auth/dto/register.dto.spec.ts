import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const validBody = {
  name: 'Mona Hassan',
  email: 'mona.hassan@example.com',
  password: 'travel2026',
  acceptTermsAndPrivacy: true,
};

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((error) => error.property) };
}

describe('RegisterDto (ACC-01)', () => {
  it('accepts a valid registration', async () => {
    const { fields } = await errorsFor(validBody);
    expect(fields).toEqual([]);
  });

  it('trims the name and normalizes the email', async () => {
    const { dto } = await errorsFor({
      ...validBody,
      name: '  Mona Hassan ',
      email: '  Mona.Hassan@Example.COM ',
    });

    expect(dto.name).toBe('Mona Hassan');
    expect(dto.email).toBe('mona.hassan@example.com');
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a password under eight characters', { password: 'trip26' }, 'password'],
    ['a password without a digit', { password: 'travelling' }, 'password'],
    ['a password without a letter', { password: '12345678' }, 'password'],
    [
      'refused consent',
      { acceptTermsAndPrivacy: false },
      'acceptTermsAndPrivacy',
    ],
    [
      'consent as a string',
      { acceptTermsAndPrivacy: 'true' },
      'acceptTermsAndPrivacy',
    ],
    ['a client-chosen role', { role: 'admin' }, 'role'],
  ])('rejects %s', async (_case, override, field) => {
    const { fields } = await errorsFor({ ...validBody, ...override });
    expect(fields).toContain(field);
  });

  it('rejects missing consent', async () => {
    const { acceptTermsAndPrivacy: _omitted, ...body } = validBody;
    const { fields } = await errorsFor(body);
    expect(fields).toContain('acceptTermsAndPrivacy');
  });
});
