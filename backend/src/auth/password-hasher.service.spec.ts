import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('stores a salted scrypt hash, never the password', async () => {
    const hash = await hasher.hash('travel2026');

    expect(hash).toMatch(
      /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
    );
    expect(hash).not.toContain('travel2026');
  });

  it('uses a new salt for every hash', async () => {
    const first = await hasher.hash('travel2026');
    const second = await hasher.hash('travel2026');

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('travel2026');

    await expect(hasher.verify('travel2026', hash)).resolves.toBe(true);
    await expect(hasher.verify('travel2027', hash)).resolves.toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    await expect(hasher.verify('travel2026', 'plain-text')).resolves.toBe(
      false,
    );
    await expect(
      hasher.verify('travel2026', 'scrypt$16384$8$1$c2FsdA==$'),
    ).resolves.toBe(false);
  });
});
