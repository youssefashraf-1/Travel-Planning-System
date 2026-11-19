# Travel Planning System

Travel planning and booking management project. Development currently focuses on the NestJS backend for Milestone 1. The Next.js frontend is reserved for Milestone 2 and has not been created yet.

## Repository structure

```text
Travel-Planning-System/
├── backend/          # NestJS application and its dependencies
│   ├── src/
│   ├── test/
│   ├── .env.example  # Safe configuration template
│   └── .env          # Local configuration; ignored by Git
├── frontend/         # Placeholder only
├── AI_PROMPTS.txt    # Record of material AI assistance
└── README.md
```

Open this repository's top-level folder in VS Code so both folders appear in Explorer. Run Git commands from this folder; run backend npm commands from `backend/`.

## Backend feature folders

```text
backend/
├── src/
│   ├── main.ts                    # Starts the application
│   ├── app/                       # Root application module and greeting endpoint
│   │   ├── app.module.ts
│   │   ├── app.controller.ts
│   │   ├── app.controller.spec.ts
│   │   └── app.service.ts
│   └── users/                     # User feature
│       ├── users.module.ts
│       ├── users.controller.ts
│       ├── users.controller.spec.ts
│       ├── users.service.ts
│       ├── users.service.spec.ts
│       └── schemas/
│           └── user.schema.ts
└── test/                          # Application-level end-to-end tests
```

Keep each feature's module, controllers, services, unit tests, and schemas in that feature's folder. Add `dto/`, guards, or other supporting files inside the feature when needed. Add new feature folders, such as `auth/`, `flights/`, and `hotels/`, when their implementation begins.

`src/main.ts` is the application entry point. The root module in `src/app/app.module.ts` loads environment configuration, connects MongoDB, and imports feature modules. Application-level end-to-end tests stay in `backend/test/` because they exercise the assembled application.

## Backend setup

Install Node.js and npm, then run:

```bash
cd backend
npm ci
```

For a fresh clone, copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB connection string. Set `JWT_ACCESS_SECRET` to your own random value of at least 32 characters (for example from `openssl rand -base64 48`); without it the backend still starts, but login returns an error. Keep an existing `.env` file unchanged. MongoDB must be reachable from your machine for the application to start.

Seed the course reference data before starting the backend against a fresh database. Run this command from `backend/` after setting `MONGODB_URI`:

```bash
npm run seed:reference
```

The command inserts or updates the official countries, cities, airports, attractions, and currencies using stable identifiers. Rerunning it keeps the same reference records and leaves other collections untouched. The [database design notes](docs/requirements/database-design.md) describe relationships, indexes, and seed behavior.

```bash
npm run start:dev
```

The default address is `http://localhost:3000`. Set `PORT` in `.env` to change it. The root endpoint `GET /` returns `Hello World!`. Business endpoints live under `/api`, and the Swagger documentation is at `http://localhost:3000/api/docs`.

Never commit `.env` or database credentials. `.env.example` contains only local database examples and blank optional monitoring settings. If enabling NestJS Observe, configure your own `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` locally.

## Checks

Run these commands inside `backend/`:

```bash
npm run build
npm test -- --runInBand
npm run lint
```

Unit tests cover schema validation, reference data, registration, and the users service. End-to-end tests create and delete records, so they never use `MONGODB_URI`. Set `MONGODB_TEST_URI` in `.env` to a disposable database whose name contains `test`. With Docker, start one and run the tests:

```bash
docker run -d --rm --name tps-e2e-mongo -p 127.0.0.1:27018:27017 mongo:8.0
```

```bash
npm run test:e2e
```

```bash
docker stop tps-e2e-mongo
```

## Milestone 1 status

- NestJS application, environment loading, and MongoDB connection configuration are present.
- Core and supporting schemas are registered with NestJS. Reference data can be loaded with `npm run seed:reference`.
- Traveler registration (ACC-01) is available at `POST /api/auth/register`.
- Login (ACC-04, ACC-05) is available at `POST /api/auth/login`. It sets a signed JWT in an HttpOnly cookie and locks an account for 15 minutes after five consecutive wrong passwords. Feature modules protect routes with `@UseGuards(JwtAuthGuard)` and read the signed-in user with `@CurrentUser()`.
- Logout, the 30-minute session, `/api/auth/me`, and the remaining account operations are in progress.
- Travel and booking features remain to be implemented against the assignment requirements.
- `frontend/` contains only `.gitkeep` so Git preserves the placeholder directory.

Before starting new work, pull the latest `develop` changes and create a feature, fix, refactor, or documentation branch. Open a pull request into `develop` for team-leader review; merge milestone releases from `develop` into `main`. Commit source changes and the relevant lockfile; keep credentials, dependencies, and generated build output out of Git. Record material AI assistance in `AI_PROMPTS.txt` throughout development.
