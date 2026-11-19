import 'reflect-metadata';
import { createConnection, type Connection } from 'mongoose';
import { User, UserRole, UserSchema } from '../users/schemas/user.schema';
import { normalizeEmail } from '../users/users.service';
import { PASSWORD_MIN_LENGTH } from './dto/password-rules';
import { PasswordHasherService } from './password-hasher.service';

/**
 * ACC-18: administrator accounts are created by seeding; there is no admin
 * self-registration. Reads ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD from
 * backend/.env. Running it again leaves an existing admin unchanged.
 */
export async function seedAdmin(
  connection: Connection,
  input: { name: string; email: string; password: string },
): Promise<'created' | 'exists'> {
  const users = connection.model(User.name, UserSchema);
  const email = normalizeEmail(input.email);

  const existing = await users.findOne({ email }).lean();
  if (existing) {
    if (existing.role !== UserRole.ADMIN) {
      throw new Error(
        `${email} already belongs to a ${existing.role} account; choose another ADMIN_EMAIL.`,
      );
    }
    return 'exists';
  }

  await users.create({
    name: input.name.trim(),
    email,
    passwordHash: await new PasswordHasherService().hash(input.password),
    role: UserRole.ADMIN,
  });
  return 'created';
}

function readAdminInput() {
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD ?? '';

  const problems: string[] = [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push('ADMIN_EMAIL must be a valid email address');
  }
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    problems.push(
      'ADMIN_PASSWORD must have at least 8 characters with a letter and a digit',
    );
  }
  return { name, email: email ?? '', password, problems };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const { problems, ...input } = readAdminInput();
  if (!uri) {
    problems.unshift('MONGODB_URI is not set');
  }
  if (problems.length > 0) {
    console.error(
      `Cannot seed the admin account: ${problems.join('; ')}. ` +
        'Set these in backend/.env (see .env.example).',
    );
    process.exitCode = 1;
    return;
  }

  const connection = createConnection();
  try {
    await connection.openUri(uri!, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 8000,
    });
    const result = await seedAdmin(connection, input);
    console.log(
      result === 'created'
        ? `Admin account created for ${normalizeEmail(input.email)}.`
        : `Admin account ${normalizeEmail(input.email)} already exists; it was left unchanged.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Admin seed failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  void main();
}
