// End-to-end tests create and delete records, so they must never run against
// the shared team database. They use MONGODB_TEST_URI instead of MONGODB_URI.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on variables already set in the shell.
}

const testUri = process.env.MONGODB_TEST_URI;

if (!testUri) {
  throw new Error(
    'Set MONGODB_TEST_URI to a disposable test database before running e2e ' +
      'tests (see backend/.env.example).',
  );
}
if (testUri === process.env.MONGODB_URI) {
  throw new Error('MONGODB_TEST_URI must differ from MONGODB_URI.');
}
const databaseName = new URL(testUri).pathname.replace(/^\//, '');
if (!/test/i.test(databaseName)) {
  throw new Error(
    'The MONGODB_TEST_URI database name must contain "test", for example ' +
      'travel_planning_system_test.',
  );
}

process.env.MONGODB_URI = testUri;
